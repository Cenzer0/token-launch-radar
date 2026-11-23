// LaunchScope dashboard: renders window.RADAR (written beside this page by main.ts).
// No network, no framework: a sortable, filterable board, a detail view per protocol,
// and a Live view of the protocols whose token already trades, kept off the board.

const R = window.RADAR;
const app = document.getElementById('app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => (n === null || n === undefined ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const moneyShort = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
};
const pct = (n) => (n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%');
const pctClass = (n) => (n === null || n === undefined || n === 0 ? 'flat' : n > 0 ? 'up' : 'down');
const ageText = (d) => (d === null || d === undefined ? 'unknown' : d >= 730 ? (d / 365).toFixed(1) + ' yrs' : d >= 60 ? Math.round(d / 30.4) + ' mo' : d + ' days');

document.getElementById('asof').innerHTML =
  'Snapshot ' + esc(R.as_of) + '<br>' + R.board_size + ' candidates ranked &middot; ' + R.watchlist_size + ' watchlist covered';
document.getElementById('src').textContent = 'Data: ' + R.source + '. Model ' + R.model_version + ', stated in full in the footer. Implied values are this board\'s own claim, not a prediction that a token will be issued.';

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const params = new URLSearchParams(qs || '');
  if (path.startsWith('detail/')) return { view: 'detail', slug: decodeURIComponent(path.slice(7)) };
  if (path === 'live') return { view: 'live' };
  return {
    view: 'board',
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    watch: params.get('watch') === '1',
    min: params.get('min') || '',
  };
}

function go(hash) { location.hash = hash; }

let sortKey = 'rank';
let sortDir = 1;

function boardView(st) {
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  const totalImplied = R.rows.reduce((a, r) => a + r.implied_value_usd, 0);
  const gainers = R.rows.filter((r) => (r.change_7d ?? 0) > 0).length;

  let html = '<section class="stats">'
    + stat(R.board_size, 'pre-token candidates ranked')
    + stat(R.watchlist_size + ' / ' + R.watchlist_size, 'watchlist protocols covered')
    + stat(moneyShort(totalImplied), 'combined implied value')
    + stat(gainers, 'candidates growing this week')
    + '</section>';

  html += '<form class="controls" id="ctl">'
    + '<input type="search" id="q" placeholder="Search name or slug" value="' + esc(st.q) + '">'
    + '<select id="cat"><option value="">All categories</option>' + cats.map((c) => '<option' + (c === st.cat ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>'
    + '<select id="chain"><option value="">All chains</option>' + chains.map((c) => '<option' + (c === st.chain ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>'
    + '<select id="min"><option value="">Any TVL</option>'
    + [['50000000', 'TVL over $50M'], ['250000000', 'TVL over $250M'], ['1000000000', 'TVL over $1B']].map(([v, t]) => '<option value="' + v + '"' + (v === st.min ? ' selected' : '') + '>' + t + '</option>').join('')
    + '</select>'
    + '<label class="check"><input type="checkbox" id="watch"' + (st.watch ? ' checked' : '') + '> Watchlist only</label>'
    + '<span class="tabs"><button type="button" class="on">Launch board</button><button type="button" id="toLive">Already trading</button></span>'
    + '</form>';

  const rows = filtered(st);
  const active = [];
  if (st.cat) active.push('category ' + st.cat);
  if (st.chain) active.push('chain ' + st.chain);
  if (st.q) active.push('search "' + st.q + '"');
  if (st.watch) active.push('watchlist only');
  if (st.min) active.push('TVL over ' + moneyShort(Number(st.min)));
  html += '<p class="count">' + rows.length + ' of ' + R.rows.length + ' candidates shown'
    + (active.length ? ' — filtered by ' + esc(active.join(', ')) : '')
    + '. Click a column to sort; click a row for its detail and farm plan.</p>';
  html += '<table><thead><tr>'
    + th('rank', '#', '') + th('name', 'Protocol', '') + '<th>Category</th><th>Chains</th>'
    + th('tvl_usd', 'TVL', 'num') + th('change_7d', '7d', 'num') + th('age_days', 'Tokenless for', 'num')
    + th('implied_value_usd', 'Implied value', 'num') + th('score', 'Score', 'num')
    + '</tr></thead><tbody>';
  for (const r of rows) {
    html += '<tr data-slug="' + esc(r.slug) + '">'
      + '<td class="rank">' + r.rank + '</td>'
      + '<td><span class="pname">' + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + '</span></td>'
      + '<td>' + (r.watchlist ? '<span class="chip watch">Watchlist</span> ' : '') + '<span class="chip">' + esc(r.category ?? 'Uncategorised') + '</span></td>'
      + '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>'
      + '<td class="num">' + money(r.tvl_usd) + '</td>'
      + '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>'
      + '<td class="num">' + ageText(r.age_days) + '</td>'
      + '<td class="num implied">' + money(r.implied_value_usd) + '</td>'
      + '<td class="num"><span class="scorebar"><i style="width:' + r.score + '%"></i></span> ' + r.score + '</td>'
      + '</tr>';
  }
  html += '</tbody></table>';
  if (rows.length === 0) html += '<div class="empty">No candidate matches those filters. Loosen one and the radar sweeps again.</div>';
  app.innerHTML = html;
  app.setAttribute('aria-busy', 'false');

  const apply = () => {
    const p = new URLSearchParams();
    const q = document.getElementById('q').value.trim();
    const cat = document.getElementById('cat').value;
    const chain = document.getElementById('chain').value;
    const min = document.getElementById('min').value;
    const watch = document.getElementById('watch').checked;
    if (q) p.set('q', q); if (cat) p.set('cat', cat); if (chain) p.set('chain', chain);
    if (min) p.set('min', min); if (watch) p.set('watch', '1');
    go('/board' + (p.toString() ? '?' + p.toString() : ''));
  };
  document.getElementById('ctl').addEventListener('submit', (e) => e.preventDefault());
  for (const id of ['cat', 'chain', 'min', 'watch']) document.getElementById(id).addEventListener('change', apply);
  let timer;
  document.getElementById('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 250); });
  document.getElementById('toLive').addEventListener('click', () => go('/live'));
  for (const el of app.querySelectorAll('th[data-k]')) {
    el.addEventListener('click', () => {
      const k = el.getAttribute('data-k');
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; if (k === 'rank') sortDir = 1; }
      render();
    });
  }
  for (const tr of app.querySelectorAll('tbody tr')) {
    tr.tabIndex = 0;
    const open = () => go('/detail/' + encodeURIComponent(tr.getAttribute('data-slug')));
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  }
}

function stat(b, s) { return '<div class="stat"><b>' + b + '</b><span>' + s + '</span></div>'; }

function th(k, label, cls) {
  const dir = sortKey === k ? ' <span class="dir">' + (sortDir === 1 ? '▲' : '▼') + '</span>' : '';
  return '<th data-k="' + k + '" class="' + cls + '">' + label + dir + '</th>';
}

function filtered(st) {
  let rows = R.rows.filter((r) =>
    (!st.q || (r.name + ' ' + r.slug).toLowerCase().includes(st.q.toLowerCase()))
    && (!st.cat || r.category === st.cat)
    && (!st.chain || r.chains.includes(st.chain))
    && (!st.watch || r.watchlist)
    && (!st.min || r.tvl_usd >= Number(st.min)));
  const key = sortKey;
  rows = rows.slice().sort((a, b) => {
    const x = a[key]; const y = b[key];
    if (typeof x === 'string') return sortDir * x.localeCompare(y);
    return sortDir * ((x ?? -Infinity) - (y ?? -Infinity));
  });
  return rows;
}

function detailView(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) { app.innerHTML = '<div class="empty">That protocol is not on the board.</div>'; return; }
  const m = R.model;
  const factor = (name, v, lo, hi, note) => {
    const w = Math.max(2, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    return '<div class="factor"><div class="row"><span>' + name + '</span><b>&times;' + v.toFixed(2) + '</b></div>'
      + '<div class="track"><i style="width:' + w + '%"></i></div><p>' + note + '</p></div>';
  };
  let html = '<button class="back" id="back">&larr; Back to the board</button>'
    + '<div class="detail-head"><div><h2>' + esc(r.name) + '</h2>'
    + '<p class="sub">Rank #' + r.rank + ' of ' + R.board_size + ' &middot; ' + esc(r.category ?? 'Uncategorised') + ' &middot; ' + esc(r.chains.join(', ') || 'no chains recorded')
    + (r.watchlist ? ' &middot; on the snapshot watchlist' : ' &middot; found below the watchlist floor') + '</p></div>'
    + '<div class="big-implied"><b>' + money(r.implied_value_usd) + '</b><span>implied value</span></div></div>'
    + '<div class="grid"><section class="card"><h3>The record</h3><dl class="facts">'
    + fact('TVL', money(r.tvl_usd)) + fact('7-day TVL change', pct(r.change_7d))
    + fact('Tokenless for', ageText(r.age_days)) + fact('Tracked since', r.listed_at ?? 'not recorded')
    + fact('Chains', String(r.chains.length)) + fact('Score', r.score + ' / 100')
    + '</dl>'
    + '<h3 style="margin-top:20px">Why this value</h3>'
    + '<p style="color:var(--dim);margin-top:0">TVL ' + money(r.tvl_usd) + ' &times; ' + m.base_multiple + ' base, then three factors from the record itself:</p>'
    + factor('Momentum', r.momentum, 0.55, 1.65, 'Its 7-day TVL change of ' + pct(r.change_7d) + ', read through the saturating curve so one wild week cannot dominate.')
    + factor('Maturity', r.maturity, 0.6, 1.15, 'Time run with no token: ' + ageText(r.age_days) + '. The curve peaks near 22 months tokenless.')
    + factor('Breadth', r.breadth, 1, 1.32, 'TVL already sits on ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ': distribution a launch would inherit.')
    + '</section>'
    + '<section class="card"><h3>Farm plan</h3><ol class="steps">'
    + r.steps.map((s) => '<li>' + esc(s.text) + '<span class="meta"><span>Cost: ' + esc(s.cost) + '</span><span class="t">Time: ' + esc(s.time) + '</span></span></li>').join('')
    + '</ol></section></div>';
  app.innerHTML = html;
  app.setAttribute('aria-busy', 'false');
  document.getElementById('back').addEventListener('click', () => go('/board'));
}

function fact(k, v) { return '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }

function liveView() {
  let html = '<form class="controls"><span style="color:var(--dim)">These protocols already have a token: the market prices them, so the radar keeps them off the ranked board.</span>'
    + '<span class="tabs"><button type="button" id="toBoard">Launch board</button><button type="button" class="on">Already trading</button></span></form>'
    + '<table><thead><tr><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">7d</th></tr></thead><tbody>';
  for (const r of R.live) {
    html += '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + '</span></td>'
      + '<td><span class="chip">' + esc(r.category ?? 'Uncategorised') + '</span></td>'
      + '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>'
      + '<td class="num implied">' + money(r.mcap_usd) + '</td>'
      + '<td class="num">' + money(r.tvl_usd) + '</td>'
      + '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td></tr>';
  }
  html += '</tbody></table>';
  app.innerHTML = html;
  app.setAttribute('aria-busy', 'false');
  document.getElementById('toBoard').addEventListener('click', () => go('/board'));
  for (const tr of app.querySelectorAll('tbody tr')) tr.style.cursor = 'default';
}

function render() {
  const st = route();
  if (st.view === 'detail') detailView(st.slug);
  else if (st.view === 'live') liveView();
  else boardView(st);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
render();
