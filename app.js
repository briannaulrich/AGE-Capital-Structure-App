/*
 * app.js — reads the CSV files in data/, runs the math in capstruct.js
 * and draws the tables. All the finance lives in capstruct.js.
 */
(function () {
  'use strict';

  var C = window.CapStruct;

  // ---------- Formatting (round half up on the decimal value) ----------

  function group(n, d) {
    var parts = Math.abs(n).toFixed(d).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function fixed(x, d) {
    var r = C.roundHalfUp(x, d);
    return (r < 0 ? '−' : '') + group(r, d);
  }
  var NA = 'n/a';
  function dollars(x) { return x === null ? NA : (x < 0 ? '−$' : '$') + group(Math.abs(C.roundHalfUp(x, 0)), 0); }
  function cost(x) { return x === null ? NA : '(' + group(Math.abs(C.roundHalfUp(x, 0)), 0) + ')'; }
  function cents(x) { return x === null ? NA : (x < 0 ? '−$' : '$') + group(Math.abs(C.roundHalfUp(x, 2)), 2); }
  function pct(x) { return x === null ? NA : fixed(x * 100, 2) + '%'; }
  function times(x) { return x === null ? NA : fixed(x, 2) + '×'; }
  function shares(x) { return x === null ? NA : fixed(x, 2); }
  function multiple(x) { return x === null ? NA : fixed(x, 2); }
  function rate(x) { return x === null ? '—' : pct(x); }

  // ---------- Small DOM helpers ----------

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  // Build a table from a header row and body rows.
  // Each body row is { label, cells: [...], cls, bestIndex }.
  function fillTable(table, captionText, header, rows) {
    table.innerHTML = '';
    if (captionText) table.appendChild(el('caption', { text: captionText }));
    var thead = el('thead');
    thead.appendChild(el('tr', null, header.map(function (h, i) {
      return el('th', { scope: 'col', text: h });
    })));
    table.appendChild(thead);
    var tbody = el('tbody');
    var span = header.length - 1;
    rows.forEach(function (r) {
      // On phones, CSS hides the label column and shows this label row instead,
      // so the numbers get the whole width of the screen.
      if (table.classList.contains('by-debt')) {
        tbody.appendChild(el('tr', { 'class': 'label-row' + (r.cls ? ' ' + r.cls : '') }, [
          el('td', { colspan: String(span), html: r.label })
        ]));
      }
      var tr = el('tr', { 'class': 'value-row' + (r.cls ? ' ' + r.cls : '') });
      tr.appendChild(el('td', { html: r.label }));
      r.cells.forEach(function (c, i) {
        tr.appendChild(el('td', i === r.bestIndex ? { 'class': 'best-cell', text: c } : { text: c }));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  // ---------- Firm U and Firm L ----------

  function firmRows(f, isU) {
    var y = f.years;
    var three = function (fn) { return y.map(fn); };
    var middle = function (v) { return ['', v, '']; };
    return [
      { label: 'Assets', cells: three(function () { return dollars(f.assets); }) },
      { label: 'Equity', cells: three(function () { return dollars(f.equity); }) },
      { label: 'Probability', cells: three(function (r) { return multiple(r.probability); }) },
      { label: 'Sales', cells: three(function (r) { return dollars(r.sales); }) },
      { label: 'Oper. costs', cells: three(function (r) { return cost(r.operatingCosts); }) },
      { label: 'EBIT', cls: 'total', cells: three(function (r) { return dollars(r.ebit); }) },
      { label: 'Interest', cells: three(function (r) { return cost(r.interest); }) },
      { label: 'EBT', cls: 'total', cells: three(function (r) { return dollars(r.ebt); }) },
      { label: 'Taxes', cells: three(function (r) { return cost(r.taxes); }) },
      { label: 'Net income', cls: 'total', cells: three(function (r) { return dollars(r.netIncome); }) },
      { label: 'ROE', cls: 'key', cells: three(function (r) { return pct(r.roe); }) },
      { label: 'TIE', cls: 'key', cells: three(function (r) { return times(r.tie); }) },
      { label: 'E(ROE)', cls: 'total', cells: middle(pct(f.roe.mean)) },
      { label: 'σ(ROE)', cells: middle(pct(f.roe.sd)) },
      { label: 'CV(ROE)', cells: middle(multiple(f.roe.cv)) },
      { label: 'E(TIE)', cells: middle(times(f.tie.mean)) },
      { label: 'σ(TIE)', cells: middle(times(f.tie.sd)) }
    ];
  }

  function renderFirms(inputs) {
    var F = inputs.firms;
    var T = inputs.taxRate;
    var u = C.firmAnalysis(inputs.scenarios, F.totalAssets, 0, F.interestRate, T);
    var l = C.firmAnalysis(inputs.scenarios, F.totalAssets, F.firmLDebt, F.interestRate, T);
    var header = ['', 'Bad', 'Normal', 'Good'];

    document.getElementById('firms-intro').textContent =
      'Both firms have ' + dollars(F.totalAssets) + ' of assets and a ' + pct(T) +
      ' tax rate. Firm U has no debt. Firm L has ' + dollars(F.firmLDebt) + ' of debt at ' +
      pct(F.interestRate) + '. Columns are the three kinds of year in the EBIT distribution.';

    fillTable(document.getElementById('firm-u'), 'Firm U (no debt)', header, firmRows(u, true));
    fillTable(document.getElementById('firm-l'), 'Firm L (' + dollars(F.firmLDebt) + ' of debt)', header, firmRows(l, false));
    document.getElementById('firms').hidden = false;
  }

  // ---------- CDSS ----------

  function renderCdss(inputs) {
    var c = inputs.cdss;
    var a = C.cdssAnalysis(inputs);
    var rows = a.rows;
    var header = ['Amount borrowed'].concat(rows.map(function (r) { return dollars(r.debt); }));
    var col = function (fn) { return rows.map(fn); };
    var idx = function (debt) {
      for (var i = 0; i < rows.length; i++) if (rows[i].debt === debt) return i;
      return -1;
    };

    document.getElementById('cdss-intro').textContent =
      'Sales ' + dollars(c.sales) + ', variable costs ' + pct(c.variableCostRate) + ' of sales, fixed costs ' +
      dollars(c.fixedCosts) + ', so EBIT = ' + dollars(a.ebit) + ' at every amount of debt. ' +
      group(c.shares, 0) + ' shares at ' + cents(c.price) + ', tax rate ' + pct(inputs.taxRate) +
      ', book assets ' + dollars(c.totalAssets) + '. CDSS pays out all its earnings, so dividends per share = EPS and g = 0.';

    var zc = document.getElementById('zero-check');
    if (a.zeroCheck.ok) {
      zc.className = 'check ok';
      zc.textContent = 'Check passed: with no debt, EPS ÷ r_s = ' + cents(a.zeroCheck.implied) +
        ', the same as today\'s price in cdss.csv.';
    } else {
      zc.className = 'check fail';
      zc.textContent = '⚠ Check failed: ' + (a.zeroCheck.message ||
        ('with no debt, EPS ÷ r_s = ' + cents(a.zeroCheck.implied) + ', but cdss.csv says today\'s price is ' +
          cents(a.zeroCheck.actual) + '. The schedule\'s $0 cost of equity doesn\'t fit today\'s price.'));
    }

    fillTable(document.getElementById('cdss-common'), null, header, [
      { label: 'Cost of debt, r<sub>d</sub>', cells: col(function (r) { return rate(r.rd); }) },
      { label: 'Cost of equity, r<sub>s</sub>', cells: col(function (r) { return rate(r.rs); }) },
      { label: 'EBIT', cells: col(function (r) { return dollars(r.ebit); }) },
      { label: 'Interest', cells: col(function (r) { return dollars(r.interest); }) },
      { label: 'Net income', cls: 'total', cells: col(function (r) { return dollars(r.netIncome); }) },
      { label: 'TIE', cls: 'key', cells: col(function (r) { return times(r.tie); }) }
    ]);

    fillTable(document.getElementById('cdss-case'), null, header, [
      { label: 'Shares repurchased', cells: col(function (r) { return shares(r.caseMethod.repurchased); }) },
      { label: 'Shares remaining', cells: col(function (r) { return shares(r.caseMethod.remaining); }) },
      { label: 'EPS', cls: 'key', cells: col(function (r) { return cents(r.caseMethod.eps); }), bestIndex: idx(a.best.caseEps) },
      { label: 'Share price', cls: 'key', cells: col(function (r) { return cents(r.caseMethod.price); }), bestIndex: idx(a.best.casePrice) },
      { label: 'WACC (book weights)', cls: 'key', cells: col(function (r) { return pct(r.caseMethod.wacc); }), bestIndex: idx(a.best.waccBook) }
    ]);

    fillTable(document.getElementById('cdss-new'), null, header, [
      { label: 'Value of equity, S', cells: col(function (r) { return dollars(r.newPriceMethod.equityValue); }) },
      { label: 'Value of firm, V', cells: col(function (r) { return dollars(r.newPriceMethod.firmValue); }) },
      { label: 'Share price', cls: 'key', cells: col(function (r) { return cents(r.newPriceMethod.price); }), bestIndex: idx(a.best.newPrice) },
      { label: 'Shares repurchased', cells: col(function (r) { return shares(r.newPriceMethod.repurchased); }) },
      { label: 'Shares remaining', cells: col(function (r) { return shares(r.newPriceMethod.remaining); }) },
      { label: 'EPS', cls: 'key', cells: col(function (r) { return cents(r.newPriceMethod.eps); }), bestIndex: idx(a.best.newEps) },
      { label: 'WACC (market weights)', cls: 'key', cells: col(function (r) { return pct(r.newPriceMethod.wacc); }), bestIndex: idx(a.best.waccMarket) },
      { label: 'Check: EPS = r<sub>s</sub> × price', cells: col(function (r) { return r.newPriceMethod.checks.epsEqualsRsTimesP ? '✓' : '✗'; }) },
      { label: 'Check: WACC = EBIT(1−T) ÷ V', cells: col(function (r) { return r.newPriceMethod.checks.waccEqualsEbitAfterTaxOverV ? '✓' : '✗'; }) }
    ]);

    var b = a.best;
    var list = document.getElementById('cdss-best');
    list.innerHTML = '';
    var items = [
      'Highest share price, case method ($20 buyback): ' + dollars(b.casePrice) + ' of debt',
      'Highest share price, new-price method: ' + dollars(b.newPrice) + ' of debt',
      'Lowest WACC, book weights: ' + dollars(b.waccBook) + ' of debt',
      'Lowest WACC, market weights: ' + dollars(b.waccMarket) + ' of debt',
      'Highest EPS: ' + dollars(b.caseEps) + ' (case method), ' + dollars(b.newEps) + ' (new-price method)'
    ];
    items.forEach(function (t) { list.appendChild(el('li', { text: t })); });
    list.appendChild(el('li', b.allAgree
      ? { 'class': 'agree', text: 'Both price methods and both WACC weights agree on ' + dollars(b.casePrice) + ' of debt.' }
      : { 'class': 'disagree', text: 'These don\'t all agree, so the app doesn\'t pick one. Compare the price and WACC rows above.' }));
    list.appendChild(el('li', { text: '★ marks the best amount in each row.' }));

    var warn = [];
    rows.forEach(function (r) { r.warnings.forEach(function (w) { warn.push(dollars(r.debt) + ': ' + w); }); });
    if (warn.length) list.appendChild(el('li', { 'class': 'disagree', text: '⚠ ' + warn.join(' ') }));

    document.getElementById('cdss').hidden = false;
  }

  // ---------- Load the data ----------

  var files = {
    cdss: 'data/cdss.csv',
    assumptions: 'data/assumptions.csv',
    schedule: 'data/banker_schedule.csv',
    exampleFirms: 'data/example_firms.csv',
    scenarios: 'data/ebit_scenarios.csv'
  };
  var keys = Object.keys(files);
  var status = document.getElementById('status');

  Promise.all(keys.map(function (k) {
    return fetch(files[k], { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('Could not load ' + files[k] + ' (' + res.status + ')');
      return res.text();
    });
  })).then(function (texts) {
    var text = {};
    keys.forEach(function (k, i) { text[k] = texts[i]; });
    var inputs = C.buildInputs(text);
    renderFirms(inputs);
    renderCdss(inputs);
    status.hidden = true;
  }).catch(function (err) {
    status.className = 'status error';
    status.textContent = 'The app could not read its data: ' + err.message +
      '. If you opened index.html straight from your computer, open the published site (or a local web server) instead.';
  });
})();
