// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The page never recomputes the model and never regenerates a farm plan. data.js ships each row's
// farm_steps and its full model breakdown; the page renders them verbatim, so the screenshots, the
// code and board.json cannot drift apart. The one number the page does derive is the implied-value
// bar: its denominator is always the board's rank-1 implied value, never the first row of a
// filtered or re-sorted list.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = {
    q: '', category: 'all', chain: 'all', band: 'all', growth: 'all', tier: 'all',
    tab: 'pre-token', sort: 'implied', dir: -1, selected: null,
  };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(3);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ------------------------------------------------------------ state in the hash
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('band')) state.band = params.get('band');
    if (params.get('growth')) state.growth = params.get('growth');
    if (params.get('tier')) state.tier = params.get('tier');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('tab') === 'live') { state.sort = 'mcap'; }
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.band !== 'all') params.set('band', state.band);
    if (state.growth !== 'all') params.set('growth', state.growth);
    if (state.tier !== 'all') params.set('tier', state.tier);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ------------------------------------------------------------ filtering
  function bandOf(tvl) {
    if (tvl >= 1e9) return '1b';
    if (tvl >= 1e8) return '100m';
    if (tvl >= 5e7) return '50m';
    return 'under50';
  }
  function bandLabel(band) {
    return { '1b': 'TVL $1B+', '100m': 'TVL $100M–$1B', '50m': 'TVL $50M–$100M', 'under50': 'TVL under $50M' }[band] || band;
  }
  function matchesCommon(r, q) {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (state.chain !== 'all' && (!r.chains || !r.chains.length || r.chains[0] !== state.chain)) return false;
    if (state.band !== 'all' && bandOf(r.tvl_usd) !== state.band) return false;
    if (state.growth === 'gainers' && !(r.change_7d !== null && r.change_7d > 0)) return false;
    if (state.growth === 'losers' && !(r.change_7d !== null && r.change_7d < 0)) return false;
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      return matchesCommon(r, q);
    });
  }
  function filteredLive() {
    var q = state.q.trim().toLowerCase();
    return DATA.live.filter(function (r) { return matchesCommon(r, q); });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'mcap') { av = a.mcap_usd === null ? -Infinity : a.mcap_usd; bv = b.mcap_usd === null ? -Infinity : b.mcap_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // The bar denominator: the board's rank-1 implied value, always — never the first row of a
  // filtered or re-sorted list.
  var RANK1 = (DATA.rows[0] && DATA.rows[0].implied_value_usd) || 1;
  var TOP_LIVE = (DATA.live[0] && DATA.live[0].mcap_usd) || 1;

  // ------------------------------------------------------------ static shell
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Source ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ', el('b', { text: fmtUsd(DATA.floor_usd) }),
          ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor, and ', el('b', { text: String(DATA.flagged_size) }),
          ' flagged rows for completeness. Model ', el('b', { text: DATA.model_version }),
          ' prices each category from the market caps of the protocols that already trade — the screenshots, the code and board.json all carry the same numbers.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function countsBy(list, keyFn) {
    var counts = {};
    list.forEach(function (r) { var k = keyFn(r); counts[k] = (counts[k] || 0) + 1; });
    return counts;
  }

  function controls() {
    var catCounts = countsBy(DATA.rows, function (r) { return r.category || 'Other'; });
    var categories = Object.keys(catCounts).sort();
    var chainCounts = countsBy(DATA.rows, function (r) { return (r.chains && r.chains.length ? r.chains[0] : 'No chain'); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).slice(0, 20);

    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderBoard(); });
    var category = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories (' + DATA.rows.length + ')' }),
      categories.map(function (c) {
        return el('option', { value: c, text: c + ' (' + catCounts[c] + ')', selected: c === state.category ? 'selected' : null });
      })
    );
    category.addEventListener('change', function () { state.category = category.value; writeHash(); renderBoard(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by first chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) {
        return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null });
      })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); renderBoard(); });
    var band = el('select', { id: 'band', 'aria-label': 'Filter by TVL band' },
      el('option', { value: 'all', text: 'Any TVL' }),
      ['1b', '100m', '50m', 'under50'].map(function (b) {
        return el('option', { value: b, text: bandLabel(b), selected: b === state.band ? 'selected' : null });
      })
    );
    band.addEventListener('change', function () { state.band = band.value; writeHash(); renderBoard(); });
    var growth = el('select', { id: 'growth', 'aria-label': 'Filter by seven-day growth' },
      el('option', { value: 'all', text: 'Any 7d move' }),
      el('option', { value: 'gainers', text: 'Gainers (7d up)', selected: state.growth === 'gainers' ? 'selected' : null }),
      el('option', { value: 'losers', text: 'Losers (7d down)', selected: state.growth === 'losers' ? 'selected' : null })
    );
    growth.addEventListener('change', function () { state.growth = growth.value; writeHash(); renderBoard(); });

    var tierBtns = [['all', 'All tiers'], ['watchlist', 'Watchlist'], ['early', 'Early'], ['flagged', 'Tier-2 flagged']].map(function (pair) {
      return el('button', {
        type: 'button', 'aria-pressed': state.tier === pair[0] ? 'true' : 'false', text: pair[1],
        onclick: function () { state.tier = pair[0]; writeHash(); renderBoard(); },
      });
    });
    var pre = el('button', {
      type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token',
      onclick: function () { state.tab = 'pre-token'; state.sort = 'implied'; state.dir = -1; writeHash(); renderBoard(); },
    });
    var live = el('button', {
      type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token',
      onclick: function () { state.tab = 'live'; state.sort = 'mcap'; state.dir = -1; writeHash(); renderBoard(); },
    });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), category),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'First chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'band', text: 'TVL band' }), band),
      el('div', { class: 'field' }, el('label', { for: 'growth', text: 'Seven-day move' }), growth),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('div', { class: 'field', style: 'grid-column: 1 / -1' },
        el('span', { class: 'sub', text: 'Tier' }),
        el('div', { class: 'tier-row' }, tierBtns)
      )
    );
  }

  function clearFilters() {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.band = 'all';
    state.growth = 'all'; state.tier = 'all';
    writeHash();
    buildShell();
  }

  // ------------------------------------------------------------ chips + count
  function chipsRow() {
    var chips = [];
    function addChip(label, clear) {
      chips.push(el('span', { class: 'chip' }, label,
        el('button', { type: 'button', 'aria-label': 'Remove filter ' + label, text: '×', onclick: clear })));
    }
    if (state.q) addChip('“' + state.q + '”', function () { state.q = ''; buildShell(); });
    if (state.category !== 'all') addChip(state.category, function () { state.category = 'all'; buildShell(); });
    if (state.chain !== 'all') addChip(state.chain, function () { state.chain = 'all'; buildShell(); });
    if (state.band !== 'all') addChip(bandLabel(state.band), function () { state.band = 'all'; buildShell(); });
    if (state.growth !== 'all') addChip(state.growth === 'gainers' ? 'Gainers' : 'Losers', function () { state.growth = 'all'; buildShell(); });
    if (state.tier !== 'all') addChip(state.tier === 'watchlist' ? 'Watchlist' : state.tier === 'early' ? 'Early' : 'Tier-2 flagged', function () { state.tier = 'all'; buildShell(); });
    var countText = state.tab === 'pre-token'
      ? filteredRows().length + ' of ' + DATA.board_size + ' rows shown'
      : filteredLive().length + ' of ' + DATA.live.length + ' live-token protocols shown';
    var row = el('div', { class: 'chips' }, chips, el('span', { class: 'count', text: countText }));
    if (chips.length > 0) row.appendChild(el('button', { class: 'clear', type: 'button', text: 'Clear all filters', onclick: clearFilters }));
    return row;
  }

  // ------------------------------------------------------------ tables
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', {
        type: 'button',
        onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderBoard(); },
      },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function tierBadge(tier) {
    if (tier === 'watchlist') return el('span', { class: 'tier-badge watchlist', text: 'Watchlist' });
    if (tier === 'early') return el('span', { class: 'tier-badge early', text: 'Early' });
    return el('span', { class: 'tier-badge flagged', text: 'Tier-2 flagged' });
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: clearFilters })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        el('td', { class: 'num' }, el('span', { class: 'rank-badge' + (r.rank <= 3 ? ' top3' : ''), text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          tierBadge(r.tier)
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num hide-narrow', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / RANK1) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            el('th', { scope: 'col', class: 'hide-narrow', text: 'Age' }),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var list = sortedRows(filteredLive());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No live-token protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the live set again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: clearFilters })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num' }, el('span', { class: 'status live', text: 'live' })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num' }, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round(((r.mcap_usd || 0) / TOP_LIVE) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.mcap_usd) })
        )),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('mcap', 'Market cap'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  // ------------------------------------------------------------ detail view
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    if (state.selected) { state.selected = null; writeHash(); renderBoard(); }
  });

  function caveatsFor(row) {
    var out = [];
    if (row.tier === 'flagged') {
      out.push('Flagged Tier-2: this row looks like a wrapped, staked or bridge product of something that already trades, so it is ranked for completeness, not as a clean pre-token launch.');
    }
    if (row.age_days === null || row.age_days === undefined) {
      out.push('Age unknown: the snapshot carries no first-listed date for this protocol, so the model uses 365 days. A younger protocol would score lower on maturity.');
    }
    if ((row.category || '') === 'Chain') {
      out.push('This row is a chain, not an app: its TVL is the chain\u2019s locked value, and a chain token would be a different kind of launch from an app token.');
    }
    if ((row.category || '').indexOf('Restak') >= 0 || (row.category || '') === 'Staking Pool') {
      out.push('Staking and restaking rows carry a receipt for the stake. The receipt is a claim on the stake, not the protocol\u2019s own token.');
    }
    if (row.model.multiple_n === 1) {
      out.push('Its category multiple comes from a single comparable, shrunk toward the global median \u2014 the thinnest evidence on the board. Ranks 1\u20133 are driven by it.');
    }
    if (row.model.multiple_n === 0) {
      out.push('Its category has no live-token comparable, so it uses the global median multiple.');
    }
    if (row.change_7d !== null && (row.change_7d > 120 || row.change_7d < -60)) {
      out.push('Seven-day growth is clamped to \u221260%\u2026+120% before scoring, so one wild week cannot set the rank.');
    }
    return out;
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var m = row.model;
    var growthLine = row.change_7d === null
      ? 'not recorded'
      : fmtPct(row.change_7d) + (row.change_7d > 120 || row.change_7d < -60 ? ' (clamped to ' + fmtPct(m.growth_pct) + ')' : '');
    var ageLine = row.age_days === null
      ? 'unknown (model uses 365d)'
      : fmtAge(row.age_days) + (row.age_days > 1095 ? ' (capped at 3y)' : '');
    var multLine = fmtMult(m.multiple) + '  \u00b7  n=' + m.multiple_n +
      (m.multiple_p25 !== null ? '  \u00b7  p25\u2013p75 ' + fmtMult(m.multiple_p25) + ' \u2013 ' + fmtMult(m.multiple_p75) : '  \u00b7  no comparables, global median');
    var steps = (row.farm_steps || []).map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('b', { text: action }), tail ? el('span', { class: 'cost', text: tail }) : null);
    });
    var prev = null, next = null;
    DATA.rows.forEach(function (r) {
      if (r.rank === row.rank - 1) prev = r;
      if (r.rank === row.rank + 1) next = r;
    });

    dialog.textContent = '';
    var inner = el('div', { class: 'detail-inner' });
    inner.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'eyebrow', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + '  \u00b7  ' + (row.tier === 'watchlist' ? 'Watchlist' : row.tier === 'early' ? 'Early radar' : 'Tier-2 flagged') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'button close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    inner.appendChild(el('div', { class: 'detail-nav' },
      prev ? el('button', { class: 'button', type: 'button', text: '\u2190 #' + prev.rank + ' ' + prev.name, onclick: function () { openDetail(prev.slug); } }) : el('span'),
      next ? el('button', { class: 'button', type: 'button', text: '#' + next.rank + ' ' + next.name + ' \u2192', onclick: function () { openDetail(next.slug); } }) : el('span')
    ));
    var equation = el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsdFull(row.tvl_usd) })),
      el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: multLine })),
      el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: growthLine })),
      el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(m.growth_multiplier) })),
      el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: ageLine })),
      el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(m.maturity_multiplier) })),
      el('div', null, el('span', { text: 'Chains (' + (row.chains ? row.chains.length : 0) + ')' }), el('b', { class: 'num', text: fmtMult(m.chain_multiplier) })),
      el('div', null, el('span', { text: 'Implied value before tie-break' }), el('b', { class: 'num', text: fmtUsdFull(m.raw) })),
      el('div', { class: 'total' }, el('span', { text: m.tie_adjusted ? 'Implied value (shaved $1 to keep the ranking strictly decreasing)' : 'Implied value' }), el('b', { class: 'num', text: fmtUsdFull(row.implied_value_usd) }))
    );
    var eqSection = el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }), equation);
    caveatsFor(row).forEach(function (c) { eqSection.appendChild(el('p', { class: 'caveat', text: c })); });
    eqSection.appendChild(el('p', { class: 'detail-foot', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. This is an estimate, not a price.' }));
    inner.appendChild(eqSection);
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps)
    ));
    dialog.appendChild(inner);
    renderBoard();
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // ------------------------------------------------------------ model + method
  function modelPanel() {
    var m = DATA.model;
    var rows = DATA.multiples.map(function (x) {
      return el('tr', null,
        el('td', { text: x.category }),
        el('td', { class: 'num', text: String(x.n) }),
        el('td', { class: 'num', text: x.median === null ? 'n/a' : fmtMult(x.median) }),
        el('td', { class: 'num', text: (x.p25 === null ? 'n/a' : fmtMult(x.p25)) + ' \u2013 ' + (x.p75 === null ? 'n/a' : fmtMult(x.p75)) }),
        el('td', { class: 'num', text: fmtMult(x.multiple) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', null, 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The multiple is earned from the market: for each category, the median market-cap-to-TVL ratio of the protocols that already trade, shrunk toward the global median with weight n / (n + ', String(m.shrink_prior), ') and clamped to ', fmtMult(m.multiple_floor), ' \u2013 ', fmtMult(m.multiple_cap), '.'),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd \u00d7 multiple(category) \u00d7 (1 + clamp(change_7d, ', String(m.growth_floor), ', ', String(m.growth_cap), ') / 100 \u00d7 ', String(m.growth_weight), ') \u00d7 (', String(m.maturity_floor), ' + min(age_days, ', String(m.maturity_days), ') / ', String(m.maturity_days), ' \u00d7 ', String(m.maturity_range), ') \u00d7 (1 + ', String(m.chain_step), ' \u00d7 min(chains \u2212 1, ', String(m.chain_cap), ')) )'
      ),
      el('p', null, 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ', String(m.unknown_age_days), ' days. Growth is clamped so one wild week cannot set a rank, and the ranking is walked strictly decreasing so no two rows share a value.'),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'mult' },
          el('caption', { text: 'Category multiples, earned from ' + DATA.comparables + ' live-token comparables (global median ' + fmtMult(DATA.global_multiple) + ').' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'n' }),
            el('th', { scope: 'col', text: 'Median' }),
            el('th', { scope: 'col', text: 'p25 \u2013 p75' }),
            el('th', { scope: 'col', text: 'Multiple used' })
          )),
          el('tbody', null, rows)
        )
      ),
      el('div', { class: 'limit' },
        el('b', { text: 'What this does not claim' }),
        el('p', { text: '\u201cRecords no token\u201d is not \u201chas no token\u201d: the snapshot is an index, and a protocol can hold a token the index has not recorded. listed_at is the date the index first tracked the protocol, not its launch date. Implied value is this entry\u2019s claim about what a launch would be worth, not a price and not a promise.' })
      )
    );
  }

  function methodPanel() {
    return el('section', { class: 'panel method' },
      el('h2', { text: 'Methodology' }),
      el('ul', null,
        el('li', null, 'Snapshot ', el('b', { text: DATA.as_of }), ', source ', el('b', { text: DATA.source }), ', watchlist floor ', el('b', { text: fmtUsd(DATA.floor_usd) }), '.'),
        el('li', null, 'Coverage: ', el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), ' watchlist protocols, plus ', el('b', { text: String(DATA.early_size) }), ' clean early rows below the floor and ', el('b', { text: String(DATA.flagged_size) }), ' flagged Tier-2 rows \u2014 ', el('b', { text: String(DATA.board_size) }), ' rows in total.'),
        el('li', null, 'Comparables cleaned from 416 live-token rows to ', el('b', { text: String(DATA.comparables) }), ': versioned sub-rows, exchanges and rows with no CoinGecko id or no market cap are out.'),
        el('li', null, 'Live-token protocols are set aside with their market caps shown, never ranked by the model. The board is pre-token rows only.'),
        el('li', null, 'Farm plans are derived from each protocol\u2019s own category, chains, TVL and age, with a cost and a time on every step. No step names a URL or a points program the snapshot does not record.')
      ),
      el('p', { text: 'Run it yourself: the repository\u2019s main.ts reads the same sealed snapshot and reproduces this board, byte for byte.' })
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Token Radar \u00b7 model ' + DATA.model_version + ' \u00b7 snapshot ' + DATA.as_of + ' \u00b7 source ' + DATA.source }),
      el('p', { text: 'Implied value is an estimate, not a price. Nothing here is investment advice.' })
    );
  }

  // ------------------------------------------------------------ render
  var shell, boardHost;
  function buildShell() {
    app.textContent = '';
    shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(chipsRow());
    boardHost = el('div');
    shell.appendChild(boardHost);
    shell.appendChild(modelPanel());
    shell.appendChild(methodPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    renderBoard();
  }

  function renderBoard() {
    if (!boardHost) return;
    boardHost.textContent = '';
    var chips = shell.querySelector('.chips');
    if (chips) chips.replaceWith(chipsRow());
    boardHost.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    // Keep the tab and tier buttons honest after a re-render of the shell.
    shell.querySelectorAll('.tabs button').forEach(function (b, i) {
      b.setAttribute('aria-pressed', (i === 0) === (state.tab === 'pre-token') ? 'true' : 'false');
    });
    shell.querySelectorAll('.tier-row button').forEach(function (b, i) {
      var tiers = ['all', 'watchlist', 'early', 'flagged'];
      b.setAttribute('aria-pressed', tiers[i] === state.tier ? 'true' : 'false');
    });
  }

  readHash();
  buildShell();
  if (state.selected) openDetail(state.selected);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
