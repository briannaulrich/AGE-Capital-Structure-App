/*
 * capstruct.js — the finance math for the AGE Capital Structure App.
 *
 * Every function here is plain math: none of them touch the web page.
 * That lets us check the numbers with Node, for example:
 *   node -e "const c=require('./capstruct.js'); console.log(c.roundHalfUp(0.14025*100,2))"
 *
 * In the browser this file creates one global object, CapStruct.
 * In Node it is loaded with require('./capstruct.js').
 */
(function (exports) {
  'use strict';

  // ---------- Reading the CSV files ----------

  // Turn CSV text into an array of objects, one per row, keyed by the header.
  // Handles quoted fields, so a note with a comma in it won't break the file.
  function parseCSV(text) {
    var rows = [];
    var field = '';
    var row = [];
    var inQuotes = false;
    text = String(text).replace(/^﻿/, ''); // drop a byte-order mark if present
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (f) { return f.trim() !== ''; }); });
    if (!rows.length) return [];
    var header = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (r) {
      var obj = {};
      header.forEach(function (h, j) { obj[h] = (r[j] === undefined ? '' : r[j].trim()); });
      return obj;
    });
  }

  // A blank cell becomes null (for example, the $0 row's cost of debt).
  function num(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    var n = Number(v);
    if (!isFinite(n)) throw new Error('Not a number: "' + v + '"');
    return n;
  }

  // Look up `item` in a CSV with item,value columns.
  function lookup(rows, item, file) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].item === item || rows[i].assumption === item) return num(rows[i].value);
    }
    throw new Error(file + ' has no row for "' + item + '"');
  }

  // Build one inputs object from the text of the five CSV files.
  function buildInputs(text) {
    var cdssRows = parseCSV(text.cdss);
    var assumptionRows = parseCSV(text.assumptions);
    var firmRows = parseCSV(text.exampleFirms);
    var scheduleRows = parseCSV(text.schedule);
    var scenarioRows = parseCSV(text.scenarios);

    var schedule = scheduleRows.map(function (r) {
      return { debt: num(r.debt), rd: num(r.cost_of_debt), rs: num(r.cost_of_equity) };
    }).sort(function (a, b) { return a.debt - b.debt; });

    return {
      taxRate: lookup(assumptionRows, 'tax_rate', 'assumptions.csv'),
      cdss: {
        sales: lookup(cdssRows, 'sales', 'cdss.csv'),
        variableCostRate: lookup(cdssRows, 'variable_cost_rate', 'cdss.csv'),
        fixedCosts: lookup(cdssRows, 'fixed_costs', 'cdss.csv'),
        totalAssets: lookup(cdssRows, 'total_assets', 'cdss.csv'),
        currentDebt: lookup(cdssRows, 'debt', 'cdss.csv'),
        shares: lookup(cdssRows, 'shares_outstanding', 'cdss.csv'),
        price: lookup(cdssRows, 'share_price', 'cdss.csv'),
        managementShare: lookup(cdssRows, 'management_share', 'cdss.csv')
      },
      schedule: schedule,
      firms: {
        totalAssets: lookup(firmRows, 'total_assets', 'example_firms.csv'),
        firmLDebt: lookup(firmRows, 'firm_l_debt', 'example_firms.csv'),
        interestRate: lookup(firmRows, 'interest_rate', 'example_firms.csv'),
        sliderMax: lookup(firmRows, 'slider_max', 'example_firms.csv'),
        sliderStep: lookup(firmRows, 'slider_step', 'example_firms.csv')
      },
      scenarios: scenarioRows.map(function (r) {
        return { probability: num(r.probability), sales: num(r.sales), operatingCosts: num(r.operating_costs) };
      })
    };
  }

  // ---------- Rounding ----------

  // Round half up on the decimal value (away from zero for negatives).
  // toFixed rounds the binary value, so 14.025 can come out as 14.02.
  // toPrecision(12) first cleans off the tiny binary error.
  function roundHalfUp(x, d) {
    if (x === null || !isFinite(x)) return x;
    var f = Math.pow(10, d);
    var sign = x < 0 ? -1 : 1;
    return sign * Math.round(Number((Math.abs(x) * f).toPrecision(12))) / f;
  }

  // ---------- Statistics ----------

  // Probability-weighted mean, standard deviation and coefficient of variation.
  function stats(probabilities, values) {
    var mean = 0;
    for (var i = 0; i < values.length; i++) mean += probabilities[i] * values[i];
    var variance = 0;
    for (var j = 0; j < values.length; j++) variance += probabilities[j] * Math.pow(values[j] - mean, 2);
    var sd = Math.sqrt(variance);
    return { mean: mean, sd: sd, cv: mean !== 0 ? sd / mean : null };
  }

  // ---------- Firm U and Firm L (question c) ----------

  // One firm's partial income statement in each kind of year, plus its ratios.
  // debt = 0 gives Firm U. TIE is null (shown as n/a) when there is no interest.
  function firmAnalysis(scenarios, totalAssets, debt, rate, taxRate) {
    var equity = totalAssets - debt;
    var years = scenarios.map(function (s) {
      var ebit = s.sales - s.operatingCosts;
      var interest = rate * debt;
      var ebt = ebit - interest;
      var taxes = taxRate * ebt;
      var netIncome = ebt - taxes;
      return {
        probability: s.probability,
        sales: s.sales,
        operatingCosts: s.operatingCosts,
        ebit: ebit,
        interest: interest,
        ebt: ebt,
        taxes: taxes,
        netIncome: netIncome,
        roe: netIncome / equity,
        tie: interest > 0 ? ebit / interest : null
      };
    });
    var p = years.map(function (y) { return y.probability; });
    var roe = stats(p, years.map(function (y) { return y.roe; }));
    var hasInterest = debt * rate > 0;
    var tie = hasInterest ? stats(p, years.map(function (y) { return y.tie; })) : { mean: null, sd: null, cv: null };
    return { assets: totalAssets, debt: debt, equity: equity, years: years, roe: roe, tie: tie };
  }

  // ---------- CDSS ----------

  // EBIT = sales × (1 − variable cost rate) − fixed costs. Constant at every debt level.
  function cdssEbit(c) {
    return c.sales * (1 - c.variableCostRate) - c.fixedCosts;
  }

  // Everything for CDSS at one row of the banker's schedule.
  function cdssAtDebt(c, taxRate, row) {
    var D = row.debt;
    var rd = row.rd;
    var rs = row.rs;
    var n = c.shares;
    var P0 = c.price;
    var A = c.totalAssets;
    var T = taxRate;
    var warnings = [];

    var ebit = cdssEbit(c);
    if (D > 0 && rd === null) warnings.push('The schedule has no cost of debt at this amount.');
    var interest = D > 0 ? rd * D : 0;
    var netIncome = (ebit - interest) * (1 - T);
    var tie = interest > 0 ? ebit / interest : null;
    var afterTaxRd = rd === null ? 0 : rd * (1 - T);

    // Case method: buy back at today's price, P0.
    var caseRepurchased = D / P0;
    var caseRemaining = n - caseRepurchased;
    var caseEps = caseRemaining > 0 ? netIncome / caseRemaining : null;
    var casePrice = caseEps === null ? null : caseEps / rs;
    var waccBook = (D / A) * afterTaxRd + ((A - D) / A) * rs;
    if (caseRemaining <= 0) warnings.push('At $20 a share, this much debt would buy back every share.');

    // New-price method: buy back at the price after the announcement.
    var S = netIncome / rs;
    var V = S + D;
    var newPrice = V / n;
    var newRepurchased = D / newPrice;
    var newRemaining = n - newRepurchased;
    var newEps = newRemaining > 0 ? netIncome / newRemaining : null;
    var waccMarket = (D / V) * afterTaxRd + (S / V) * rs;
    var waccMarketCheck = ebit * (1 - T) / V;

    var close = function (a, b) { return a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)); };

    return {
      debt: D, rd: rd, rs: rs,
      ebit: ebit, interest: interest, netIncome: netIncome, tie: tie,
      caseMethod: {
        repurchased: caseRepurchased, remaining: caseRemaining,
        eps: caseEps, dps: caseEps, price: casePrice, wacc: waccBook
      },
      newPriceMethod: {
        equityValue: S, firmValue: V, price: newPrice,
        repurchased: newRepurchased, remaining: newRemaining,
        eps: newEps, dps: newEps, wacc: waccMarket,
        checks: {
          epsEqualsRsTimesP: close(newEps, rs * newPrice),
          waccEqualsEbitAfterTaxOverV: close(waccMarket, waccMarketCheck)
        }
      },
      warnings: warnings
    };
  }

  // The row with the largest (or smallest) value. On an exact tie, keep the smaller debt.
  function pick(rows, getValue, wantMax) {
    var best = null;
    rows.forEach(function (r) {
      var v = getValue(r);
      if (v === null || !isFinite(v)) return;
      if (best === null || (wantMax ? v > getValue(best) : v < getValue(best))) best = r;
    });
    return best ? best.debt : null;
  }

  // CDSS at every amount in the banker's schedule, plus which amounts are best.
  function cdssAnalysis(inputs) {
    var c = inputs.cdss;
    var rows = inputs.schedule.map(function (row) { return cdssAtDebt(c, inputs.taxRate, row); });

    var best = {
      casePrice: pick(rows, function (r) { return r.caseMethod.price; }, true),
      newPrice: pick(rows, function (r) { return r.newPriceMethod.price; }, true),
      waccBook: pick(rows, function (r) { return r.caseMethod.wacc; }, false),
      waccMarket: pick(rows, function (r) { return r.newPriceMethod.wacc; }, false),
      caseEps: pick(rows, function (r) { return r.caseMethod.eps; }, true),
      newEps: pick(rows, function (r) { return r.newPriceMethod.eps; }, true)
    };
    var choices = [best.casePrice, best.newPrice, best.waccBook, best.waccMarket];
    best.allAgree = choices.every(function (d) { return d !== null && d === choices[0]; });

    // Check: at $0 of debt, EPS / r_s should equal today's share price in cdss.csv.
    var zero = rows.filter(function (r) { return r.debt === 0; })[0];
    var zeroCheck;
    if (!zero) {
      zeroCheck = { ok: false, message: 'The schedule has no $0 row, so the app cannot check today\'s price.' };
    } else {
      var implied = zero.caseMethod.price;
      var ok = Math.abs(implied - c.price) <= 1e-9 * c.price;
      zeroCheck = { ok: ok, implied: implied, actual: c.price };
    }

    return { ebit: cdssEbit(c), rows: rows, best: best, zeroCheck: zeroCheck };
  }

  exports.parseCSV = parseCSV;
  exports.buildInputs = buildInputs;
  exports.roundHalfUp = roundHalfUp;
  exports.stats = stats;
  exports.firmAnalysis = firmAnalysis;
  exports.cdssEbit = cdssEbit;
  exports.cdssAtDebt = cdssAtDebt;
  exports.cdssAnalysis = cdssAnalysis;
})(typeof module !== 'undefined' && module.exports ? module.exports : (this.CapStruct = {}));
