(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const data = window.RADAR;
  if (!data) {
    byId('missing').hidden = false;
    return;
  }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function pair(label, value, className) {
    const group = element('div', className);
    group.append(element('dt', '', label), element('dd', 'num', value));
    return group;
  }

  const number = new Intl.NumberFormat('en-US');
  const usdOptions = { style: 'currency', currency: 'USD', maximumFractionDigits: 2 };
  const fullUsd = new Intl.NumberFormat('en-US', usdOptions);
  const compactUsd = new Intl.NumberFormat('en-US', { ...usdOptions, notation: 'compact' });
  const money = (value, formatter = fullUsd) => value == null ? '—' : formatter.format(value);
  const decimal = value => value.toFixed(4);
  const percent = value => value == null ? '—' : (value > 0 ? '+' : '') + value.toFixed(2) + '%';
  const age = days => days == null ? 'Unknown' : number.format(days) + ' d';
  const categoryOf = row => row.category ?? 'Uncategorized';
  const chainsOf = row => row.chains.join(', ') || 'Chains unrecorded';
  const rowMeta = row => categoryOf(row) + ' · ' + chainsOf(row);
  const liveNote = 'already trades — market value, not a model';

  const liveRows = data.live.map((row, index) => ({ ...row, rank: index + 1 }));
  const allRows = [...data.rows, ...liveRows];
  const rowsBySlug = new Map(allRows.map(row => [row.slug, row]));
  const searchTerms = new Map(allRows.map(row => [
    row.slug, [row.name, row.slug, categoryOf(row), ...row.chains].join(' ').toLowerCase(),
  ]));
  const categories = [...new Set(allRows.map(categoryOf))].sort((a, b) => a.localeCompare(b, 'en'));
  const maxImplied = Math.max(1, ...data.rows.map(row => row.implied_value_usd));

  const query = byId('query');
  const category = byId('category');
  const dialog = byId('detail');
  const tbody = byId('rows');
  const columns = byId('columns');
  const footer = element('div', 'results');
  const footerCount = element('p');
  const footerTotal = element('p', 'num');
  footerTotal.setAttribute('role', 'status');
  footer.append(footerCount, footerTotal);
  byId('board').append(footer);

  const sorts = {
    pre: { key: 'implied_value_usd', direction: 'descending' },
    live: { key: 'mcap_usd', direction: 'descending' },
  };
  let view = 'pre';
  let selection = null;

  for (const name of categories) {
    const option = element('option', '', name);
    option.value = name;
    category.append(option);
  }

  const date = byId('date');
  date.dateTime = data.as_of;
  date.textContent = data.as_of;
  byId('version').textContent = data.model_version;
  byId('source').textContent = data.source;
  const watchlistCovered = data.rows.filter(row => row.watchlist).length;
  byId('stats').append(
    pair('Watchlist covered', number.format(watchlistCovered) + ' / ' + number.format(data.watchlist_size), 'stat'),
    pair('Board rows', number.format(data.board_size), 'stat'),
    pair('Early rows below ' + money(data.floor_usd, compactUsd), number.format(data.early_size), 'stat'),
    pair('Live tokens set aside', number.format(data.live_size), 'stat'),
  );

  const model = data.model;
  byId('formula').textContent =
    'Implied value = round(TVL × category multiple × (maturity × growth factor + chain bonus − young discount)), bounded to the model’s value range.';
  byId('rules').append(
    pair('Growth factor', 'Clamp seven-day growth to [' + model.growth_floor + '%, ' + model.growth_cap +
      '%], using 0% when missing. Factor = 1 ± √(|clamped growth| ÷ 100) × weight. Subtract using ' +
      model.loss_weight + ' on losses and add using ' + model.gain_weight + ' on gains.'),
    pair('Maturity', model.maturity_floor + ' + ' + model.maturity_range + ' × ln(1 + min(age, ' +
      model.maturity_days + ')) ÷ ln(1 + ' + model.maturity_days + '). Use ' +
      model.unknown_age_days + ' days when age is unknown.'),
    pair('Chain bonus', model.extra_chain_bonus + ' × min(' + model.extra_chain_cap + ', max(0, distinct chains − 1)).'),
    pair('Young discount', model.young_discount + ' × max(0, 1 − (age ÷ ' + model.young_days + ')²).'),
  );
  for (const [tier, multiple] of Object.entries(model.category_multiples)) {
    byId('tiers').append(pair(tier, multiple.toFixed(2) + '×'));
  }

  function writeHash(mode = 'replaceState') {
    const params = new URLSearchParams();
    if (view === 'live') params.set('tab', 'live');
    if (query.value) params.set('q', query.value);
    if (category.value) params.set('category', category.value);
    if (selection) params.set('p', selection);
    const hash = params.size ? '#' + params.toString() : '';
    history[mode](null, '', location.pathname + location.search + hash);
  }

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const row = rowsBySlug.get(params.get('p'));
    const liveSelection = row && row.implied_value_usd === undefined;
    const nextView = params.get('tab') === 'live' || liveSelection ? 'live' : 'pre';
    const nextQuery = params.get('q') ?? '';
    const requestedCategory = params.get('category');
    const nextCategory = categories.includes(requestedCategory) ? requestedCategory : '';
    const needsRender = !columns.firstChild || view !== nextView ||
      query.value !== nextQuery || category.value !== nextCategory;

    view = nextView;
    query.value = nextQuery;
    category.value = nextCategory;
    if (needsRender) renderBoard();

    selection = row?.slug ?? null;
    if (row) renderDetail(row);
    else if (dialog.open) dialog.close();
  }

  function renderColumns(fields, sort) {
    const active = document.activeElement?.dataset.sort;
    columns.replaceChildren();
    for (const [label, key] of fields) {
      const header = element('th');
      header.scope = 'col';
      columns.append(header);
      if (!key) {
        header.textContent = label;
        continue;
      }

      const button = element('button', '', label);
      button.type = 'button';
      button.dataset.sort = key;
      const current = key === sort.key;
      const ascending = sort.direction === 'ascending';
      if (current) header.setAttribute('aria-sort', sort.direction);
      const indicator = element('span', 'direction', current ? (ascending ? '↑' : '↓') : '↕');
      indicator.setAttribute('aria-hidden', 'true');
      button.append(indicator);
      header.append(button);
      button.addEventListener('click', () => {
        const nextAscending = current ? !ascending : key === 'name';
        sort.key = key;
        sort.direction = nextAscending ? 'ascending' : 'descending';
        renderBoard();
      });
    }
    if (active) columns.querySelector('[data-sort="' + active + '"]')?.focus();
  }

  function renderRow(row, live) {
    const tr = element('tr');
    tr.tabIndex = 0;
    tr.dataset.slug = row.slug;
    tr.setAttribute('aria-haspopup', 'dialog');

    const protocol = element('td', 'protocol');
    protocol.append(element('strong', '', row.name), element('small', '', rowMeta(row)));
    const growthClass = row.change_7d > 0 ? 'pos' : row.change_7d < 0 ? 'neg' : '';
    tr.append(
      element('td', 'num rank', number.format(row.rank)),
      protocol,
      element('td', 'num', money(row.tvl_usd, compactUsd)),
      element('td', 'num ' + growthClass, percent(row.change_7d)),
    );

    const value = element('td', 'num value', money(live ? row.mcap_usd : row.implied_value_usd, compactUsd));
    if (!live) {
      tr.append(element('td', 'num', age(row.age_days)));
      const meter = element('meter');
      meter.max = maxImplied;
      meter.value = row.implied_value_usd;
      meter.setAttribute('aria-label', 'Implied value relative to highest ranked protocol');
      value.append(meter);
    }

    tr.append(value, element('td', 'status', live ? 'already trades' : 'records no token'));
    return tr;
  }

  function renderBoard() {
    const live = view === 'live';
    const sort = sorts[view];
    const valuationFields = live
      ? [['Market cap', 'mcap_usd']]
      : [['Age', 'age_days'], ['Implied value', 'implied_value_usd']];
    renderColumns([
      ['Rank'], ['Protocol', 'name'], ['TVL', 'tvl_usd'], ['7d growth', 'change_7d'],
      ...valuationFields, ['Token status'],
    ], sort);
    byId('pre').setAttribute('aria-pressed', String(!live));
    byId('live').setAttribute('aria-pressed', String(live));
    byId('view-note').textContent = live ? liveNote : 'Select a protocol for its valuation inputs and farm plan.';

    const words = query.value.trim().toLowerCase().split(/\s+/);
    const results = (live ? liveRows : data.rows).filter(row =>
      (!category.value || categoryOf(row) === category.value) &&
      words.every(word => searchTerms.get(row.slug).includes(word)));
    const direction = sort.direction === 'ascending' ? 1 : -1;
    results.sort((a, b) => {
      const left = a[sort.key];
      const right = b[sort.key];
      if (left == null || right == null) {
        return Number(left == null) - Number(right == null) || a.rank - b.rank;
      }
      const difference = sort.key === 'name' ? left.localeCompare(right, 'en') : left - right;
      return difference * direction || a.rank - b.rank;
    });

    const fragment = document.createDocumentFragment();
    for (const row of results) fragment.append(renderRow(row, live));
    tbody.replaceChildren(fragment);
    const count = number.format(results.length) + ' rows shown';
    byId('count').textContent = count;
    byId('empty').hidden = results.length !== 0;
    footerCount.textContent = count;
    const total = results.reduce((sum, row) => sum + (row.implied_value_usd ?? 0), 0);
    footerTotal.textContent = 'Total implied value · ' + (live ? '—' : money(total));
  }

  function renderDetail(row) {
    const live = row.implied_value_usd === undefined;
    byId('detail-rank').textContent = (live ? 'Market cap rank ' : 'Board rank ') + number.format(row.rank);
    const title = element('h2', '', row.name);
    title.id = 'detail-title';
    const score = element('dl', 'detail-score');
    score.append(pair(live ? 'Market cap' : 'Implied value', money(live ? row.mcap_usd : row.implied_value_usd)));
    const facts = element('dl', 'detail-facts');
    const tvlFormat = Math.abs(row.tvl_usd) >= 1_000_000_000 ? compactUsd : fullUsd;
    facts.append(pair('TVL', money(row.tvl_usd, tvlFormat)), pair('7d growth', percent(row.change_7d)));
    if (!live) facts.append(pair('Age with no token', age(row.age_days)));

    const content = byId('detail-content');
    content.replaceChildren(
      title,
      element('p', 'detail-meta', rowMeta(row)),
      element('p', 'detail-meta', live ? liveNote : 'records no token'),
      score,
      facts,
    );
    if (!live) {
      const matchingTiers = Object.keys(model.category_multiples).filter(tier =>
        model.category_multiples[tier] === row.base_multiple);
      const tierLabel = matchingTiers.length === 1 ? ' · ' + matchingTiers[0] : '';
      const inputs = element('dl', 'detail-facts');
      inputs.append(
        pair('Category multiple' + tierLabel, decimal(row.base_multiple) + '×'),
        pair('Clamped 7d growth', percent(row.growth_pct)),
        pair('Age used', age(row.age_days ?? model.unknown_age_days)),
        pair('Distinct chains', number.format(new Set(row.chains).size)),
        pair('Growth multiplier', decimal(row.growth_multiplier) + '×'),
        pair('Maturity multiplier', decimal(row.maturity_multiplier) + '×'),
        pair('Chain bonus', '+' + decimal(row.chain_bonus)),
        pair('Young discount', '−' + decimal(row.young_discount)),
      );
      const plan = element('ol', 'farm');
      for (const step of row.farm_steps) plan.append(element('li', '', step));
      content.append(element('h3', '', 'Model inputs and multipliers'), inputs, element('h3', '', 'Farm plan'), plan);
    }

    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }

  function openRow(event) {
    const row = event.target.closest('tr[data-slug]');
    if (!row) return;
    selection = row.dataset.slug;
    writeHash('pushState');
    renderDetail(rowsBySlug.get(selection));
  }

  function closeDetail() {
    if (!dialog.open) return;
    selection = null;
    writeHash();
    dialog.close();
  }

  function updateFilters() {
    writeHash();
    renderBoard();
  }

  tbody.addEventListener('click', openRow);
  tbody.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      openRow(event);
    }
  });
  byId('close').addEventListener('click', closeDetail);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeDetail();
  });
  query.addEventListener('input', updateFilters);
  category.addEventListener('change', updateFilters);
  byId('clear').addEventListener('click', () => {
    query.value = '';
    category.value = '';
    updateFilters();
  });
  for (const key of ['pre', 'live']) {
    byId(key).addEventListener('click', () => {
      view = key;
      updateFilters();
    });
  }
  window.addEventListener('hashchange', readHash);
  byId('dashboard').hidden = false;
  readHash();
})();
