/*
 * app.js — reads the CSV files in data/, runs the math in capstruct.js
 * and draws the page: the levers (sliders and buttons) and the tables.
 * All the finance lives in capstruct.js.
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

  function $(id) { return document.getElementById(id); }

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
  // selected = the column (0-based, not counting the label) to highlight.
  function fillTable(table, captionText, header, rows, selected) {
    table.innerHTML = '';
    if (captionText) table.appendChild(el('caption', { text: captionText }));
    var cls = function (i, base) {
      var c = base || '';
      if (i === selected) c += ' sel';
      return c.trim() ? { 'class': c.trim() } : {};
    };
    var thead = el('thead');
    thead.appendChild(el('tr', null, header.map(function (h, i) {
      var a = cls(i - 1); a.scope = 'col'; a.text = h;
      return el('th', a);
    })));
    table.appendChild(thead);
    var tbody = el('tbody');
    var span = header.length - 1;
    var byDebt = table.classList.contains('by-debt');
    rows.forEach(function (r) {
      // On phones, CSS hides the label column and shows this label row instead,
      // so the numbers get the whole width of the screen.
      if (byDebt) {
        tbody.appendChild(el('tr', { 'class': 'label-row' + (r.cls ? ' ' + r.cls : '') }, [
          el('td', { colspan: String(span), html: r.label })
        ]));
      }
      var tr = el('tr', { 'class': 'value-row' + (r.cls ? ' ' + r.cls : '') });
      tr.appendChild(el('td', { html: r.label }));
      r.cells.forEach(function (c, i) {
        var a = cls(i, i === r.bestIndex ? 'best-cell' : '');
        a.text = c;
        tr.appendChild(el('td', a));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  // ---------- Firm U and Firm L ----------

  function firmRows(f) {
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

  var yearNames = ['bad', 'normal', 'good'];

  function renderFirms(state) {
    var inputs = state.inputs;
    var F = inputs.firms;
    var T = inputs.taxRate;
    var u = C.firmAnalysis(inputs.scenarios, F.totalAssets, 0, F.interestRate, T);
    var l = C.firmAnalysis(inputs.scenarios, F.totalAssets, state.firmLDebt, F.interestRate, T);

    $('firm-l-debt-out').textContent = dollars(state.firmLDebt);
    $('firm-l-debt').setAttribute('aria-valuetext', dollars(state.firmLDebt));
    $('btn-case').setAttribute('aria-pressed', String(state.firmLDebt === F.firmLDebt));

    // Firm U next to Firm L: the ratios the slider moves.
    var rows = [];
    u.years.forEach(function (uy, i) {
      var name = yearNames[i] || ('year ' + (i + 1));
      rows.push({ label: 'ROE, ' + name + ' year (' + multiple(uy.probability) + ')', cells: [pct(uy.roe), pct(l.years[i].roe)] });
    });
    u.years.forEach(function (uy, i) {
      var name = yearNames[i] || ('year ' + (i + 1));
      rows.push({ label: 'TIE, ' + name + ' year', cells: [times(uy.tie), times(l.years[i].tie)] });
    });
    rows.push({ label: 'Expected ROE, E(ROE)', cls: 'key', cells: [pct(u.roe.mean), pct(l.roe.mean)] });
    rows.push({ label: 'Std. dev. of ROE, σ(ROE)', cls: 'key', cells: [pct(u.roe.sd), pct(l.roe.sd)] });
    rows.push({ label: 'Coefficient of variation, CV', cls: 'key', cells: [multiple(u.roe.cv), multiple(l.roe.cv)] });
    rows.push({ label: 'Expected TIE, E(TIE)', cells: [times(u.tie.mean), times(l.tie.mean)] });
    rows.push({ label: 'Std. dev. of TIE, σ(TIE)', cells: [times(u.tie.sd), times(l.tie.sd)] });
    fillTable($('firm-compare'), null, ['', 'Firm U', 'Firm L'], rows);

    fillTable($('firm-u'), 'Firm U (no debt)', ['', 'Bad', 'Normal', 'Good'], firmRows(u));
    fillTable($('firm-l'), 'Firm L (' + dollars(state.firmLDebt) + ' of debt)', ['', 'Bad', 'Normal', 'Good'], firmRows(l));
  }

  function setupFirms(state) {
    var inputs = state.inputs;
    var F = inputs.firms;
    var T = inputs.taxRate;
    $('firms-intro').textContent =
      'Both firms have ' + dollars(F.totalAssets) + ' of assets and a ' + pct(T) +
      ' tax rate. Firm U has no debt. In the case, Firm L has ' + dollars(F.firmLDebt) + ' of debt at ' +
      pct(F.interestRate) + '. The three kinds of year come from the EBIT distribution.';
    $('firm-l-rate-note').textContent =
      'The interest rate is held at ' + pct(F.interestRate) + ' at every amount, so the slider shows what debt does to ' +
      'Firm L\'s return and risk, not how lenders would respond to more borrowing.';

    var slider = $('firm-l-debt');
    slider.min = '0';
    slider.max = String(F.sliderMax);
    slider.step = String(F.sliderStep);
    slider.value = String(state.firmLDebt);
    $('firm-l-min').textContent = dollars(0);
    $('firm-l-max').textContent = dollars(F.sliderMax);

    slider.addEventListener('input', function () {
      state.firmLDebt = Number(slider.value);
      renderFirms(state);
    });
    $('btn-case').addEventListener('click', function () {
      state.firmLDebt = F.firmLDebt;
      slider.value = String(F.firmLDebt);
      renderFirms(state);
    });

    renderFirms(state);
    $('firms').hidden = false;
  }

  // ---------- CDSS ----------

  function stakeText(s) {
    if (s.status === 'oversold') return 'Must sell ⚠';
    if (s.status === 'all') return pct(s.value) + ' *';
    return pct(s.value);
  }

  function renderCdss(state) {
    var a = state.analysis;
    var rows = a.rows;
    var i = state.cdssIndex;
    var r = rows[i];
    var cm = r.caseMethod;
    var nm = r.newPriceMethod;

    $('cdss-debt-out').textContent = dollars(r.debt);
    $('cdss-debt').setAttribute('aria-valuetext', dollars(r.debt));
    $('cdss-rates').textContent = 'At ' + dollars(r.debt) + ', the banker quotes r_d = ' + rate(r.rd) +
      ' and r_s = ' + pct(r.rs) + '. Interest = ' + dollars(r.interest) + ', net income = ' + dollars(r.netIncome) + '.';

    // Both buyback methods side by side at the slider's amount.
    fillTable($('cdss-compare'), null, ['At ' + dollars(r.debt), 'Case method: $20 buyback', 'New-price method'], [
      { label: 'Share price', cls: 'key', cells: [cents(cm.price), cents(nm.price)] },
      { label: 'Shares repurchased', cells: [shares(cm.repurchased), shares(nm.repurchased)] },
      { label: 'Shares remaining', cells: [shares(cm.remaining), shares(nm.remaining)] },
      { label: 'EPS', cls: 'key', cells: [cents(cm.eps), cents(nm.eps)] },
      { label: 'Dividends per share', cells: [cents(cm.dps), cents(nm.dps)] },
      { label: 'TIE', cells: [times(r.tie), times(r.tie)] },
      { label: 'WACC', cls: 'key', cells: [pct(cm.wacc) + ' (book)', pct(nm.wacc) + ' (market)'] },
      { label: 'Management\'s share', cells: [stakeText(cm.managementStake), stakeText(nm.managementStake)] }
    ]);

    var notes = $('cdss-stake-notes');
    notes.innerHTML = '';
    [['Case method', cm.managementStake], ['New-price method', nm.managementStake]].forEach(function (pair) {
      var s = pair[1];
      if (s.note) notes.appendChild(el('li', {
        'class': s.status === 'oversold' ? 'warn' : '',
        text: (s.status === 'all' ? '* ' : '⚠ ') + pair[0] + ': ' + s.note
      }));
    });

    // Full tables, with the slider's column highlighted.
    var header = ['Amount borrowed'].concat(rows.map(function (x) { return dollars(x.debt); }));
    var col = function (fn) { return rows.map(fn); };
    var idx = function (debt) {
      for (var k = 0; k < rows.length; k++) if (rows[k].debt === debt) return k;
      return -1;
    };

    fillTable($('cdss-common'), null, header, [
      { label: 'Cost of debt, r<sub>d</sub>', cells: col(function (x) { return rate(x.rd); }) },
      { label: 'Cost of equity, r<sub>s</sub>', cells: col(function (x) { return rate(x.rs); }) },
      { label: 'EBIT', cells: col(function (x) { return dollars(x.ebit); }) },
      { label: 'Interest', cells: col(function (x) { return dollars(x.interest); }) },
      { label: 'Net income', cls: 'total', cells: col(function (x) { return dollars(x.netIncome); }) },
      { label: 'TIE', cls: 'key', cells: col(function (x) { return times(x.tie); }) }
    ], i);

    fillTable($('cdss-case'), null, header, [
      { label: 'Shares repurchased', cells: col(function (x) { return shares(x.caseMethod.repurchased); }) },
      { label: 'Shares remaining', cells: col(function (x) { return shares(x.caseMethod.remaining); }) },
      { label: 'EPS = dividends per share', cls: 'key', cells: col(function (x) { return cents(x.caseMethod.eps); }), bestIndex: idx(a.best.caseEps) },
      { label: 'Share price', cls: 'key', cells: col(function (x) { return cents(x.caseMethod.price); }), bestIndex: idx(a.best.casePrice) },
      { label: 'WACC (book weights)', cls: 'key', cells: col(function (x) { return pct(x.caseMethod.wacc); }), bestIndex: idx(a.best.waccBook) },
      { label: 'Management\'s share', cells: col(function (x) { return stakeText(x.caseMethod.managementStake); }) }
    ], i);

    fillTable($('cdss-new'), null, header, [
      { label: 'Value of equity, S', cells: col(function (x) { return dollars(x.newPriceMethod.equityValue); }) },
      { label: 'Value of firm, V', cells: col(function (x) { return dollars(x.newPriceMethod.firmValue); }) },
      { label: 'Share price', cls: 'key', cells: col(function (x) { return cents(x.newPriceMethod.price); }), bestIndex: idx(a.best.newPrice) },
      { label: 'Shares repurchased', cells: col(function (x) { return shares(x.newPriceMethod.repurchased); }) },
      { label: 'Shares remaining', cells: col(function (x) { return shares(x.newPriceMethod.remaining); }) },
      { label: 'EPS = dividends per share', cls: 'key', cells: col(function (x) { return cents(x.newPriceMethod.eps); }), bestIndex: idx(a.best.newEps) },
      { label: 'WACC (market weights)', cls: 'key', cells: col(function (x) { return pct(x.newPriceMethod.wacc); }), bestIndex: idx(a.best.waccMarket) },
      { label: 'Management\'s share', cells: col(function (x) { return stakeText(x.newPriceMethod.managementStake); }) },
      { label: 'Check: EPS = r<sub>s</sub> × price', cells: col(function (x) { return x.newPriceMethod.checks.epsEqualsRsTimesP ? '✓' : '✗'; }) },
      { label: 'Check: WACC = EBIT(1−T) ÷ V', cells: col(function (x) { return x.newPriceMethod.checks.waccEqualsEbitAfterTaxOverV ? '✓' : '✗'; }) }
    ], i);
  }

  function setupCdss(state) {
    var inputs = state.inputs;
    var c = inputs.cdss;
    var a = state.analysis;
    var rows = a.rows;

    $('cdss-intro').textContent =
      'Sales ' + dollars(c.sales) + ', variable costs ' + pct(c.variableCostRate) + ' of sales, fixed costs ' +
      dollars(c.fixedCosts) + ', so EBIT = ' + dollars(a.ebit) + ' at every amount of debt. ' +
      group(c.shares, 0) + ' shares at ' + cents(c.price) + ', management owns ' + pct(c.managementShare) +
      ', tax rate ' + pct(inputs.taxRate) + ', book assets ' + dollars(c.totalAssets) +
      '. CDSS pays out all its earnings, so dividends per share = EPS and g = 0.';

    var zc = $('zero-check');
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

    // The slider moves over the rows of the banker's schedule, so it can only
    // stop at the banker's amounts.
    var slider = $('cdss-debt');
    slider.max = String(rows.length - 1);
    var scale = $('cdss-scale');
    scale.innerHTML = '';
    rows.forEach(function (r) { scale.appendChild(el('span', { text: dollars(r.debt) })); });

    var start = 0;
    rows.forEach(function (r, k) { if (r.debt === c.currentDebt) start = k; });
    state.cdssIndex = start;
    slider.value = String(start);

    var note = $('cdss-button-note');
    function goTo(debt) {
      rows.forEach(function (r, k) { if (r.debt === debt) state.cdssIndex = k; });
      slider.value = String(state.cdssIndex);
      renderCdss(state);
    }
    function button(caseDebt, newDebt, what) {
      var t = C.buttonTarget(caseDebt, newDebt);
      if (t.disagree) {
        note.textContent = 'The two buyback methods pick different amounts for the ' + what + ': ' +
          dollars(t.caseDebt) + ' with the case method ($20 buyback) and ' + dollars(t.newDebt) +
          ' with the new-price method. The slider went to the case method\'s ' + dollars(t.caseDebt) + '.';
        note.hidden = false;
      } else {
        note.hidden = true;
      }
      goTo(t.debt);
    }

    slider.addEventListener('input', function () {
      state.cdssIndex = Number(slider.value);
      note.hidden = true;
      renderCdss(state);
    });
    $('btn-best-price').addEventListener('click', function () {
      button(a.best.casePrice, a.best.newPrice, 'highest share price');
    });
    $('btn-best-eps').addEventListener('click', function () {
      button(a.best.caseEps, a.best.newEps, 'highest EPS');
    });

    // Which amount of debt is best?
    var b = a.best;
    var list = $('cdss-best');
    list.innerHTML = '';
    [
      'Highest share price, case method ($20 buyback): ' + dollars(b.casePrice) + ' of debt',
      'Highest share price, new-price method: ' + dollars(b.newPrice) + ' of debt',
      'Lowest WACC, book weights: ' + dollars(b.waccBook) + ' of debt',
      'Lowest WACC, market weights: ' + dollars(b.waccMarket) + ' of debt',
      'Highest EPS: ' + dollars(b.caseEps) + ' (case method), ' + dollars(b.newEps) + ' (new-price method)'
    ].forEach(function (t) { list.appendChild(el('li', { text: t })); });
    list.appendChild(el('li', b.allAgree
      ? { 'class': 'agree', text: 'Both price methods and both WACC weights agree on ' + dollars(b.casePrice) + ' of debt.' }
      : { 'class': 'disagree', text: 'These don\'t all agree, so the app doesn\'t pick one. Compare the price and WACC rows above.' }));
    list.appendChild(el('li', { text: '★ marks the best amount in each row.' }));

    var warn = [];
    rows.forEach(function (r) { r.warnings.forEach(function (w) { warn.push(dollars(r.debt) + ': ' + w); }); });
    if (warn.length) list.appendChild(el('li', { 'class': 'disagree', text: '⚠ ' + warn.join(' ') }));

    renderCdss(state);
    $('cdss').hidden = false;
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
  var status = $('status');

  Promise.all(keys.map(function (k) {
    return fetch(files[k], { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('Could not load ' + files[k] + ' (' + res.status + ')');
      return res.text();
    });
  })).then(function (texts) {
    var text = {};
    keys.forEach(function (k, i) { text[k] = texts[i]; });
    var inputs = C.buildInputs(text);
    var state = {
      inputs: inputs,
      analysis: C.cdssAnalysis(inputs),
      firmLDebt: inputs.firms.firmLDebt,
      cdssIndex: 0
    };
    setupFirms(state);
    setupCdss(state);
    status.hidden = true;
  }).catch(function (err) {
    status.className = 'status error';
    status.textContent = 'The app could not read its data: ' + err.message +
      '. If you opened index.html straight from your computer, open the published site (or a local web server) instead.';
  });
})();
