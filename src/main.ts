import { api, basics, opensearch } from './api';
import { loadArticle } from './article';
import { combine } from './combine';
import { KIND_LABEL } from './kind';
import { buildShard, SeedError } from './live';
import { kindChips, layout, PALETTE, renderMap } from './map';
import type { Layout } from './map';
import { dailyPick, neighborhood } from './neighborhood';
import type { Radius } from './neighborhood';
import { trending } from './trending';
import type { Kind, Shard, View } from './types';
import { esc, store, wikiUrl } from './util';

const app = document.getElementById('app')!;
const MAX_SEEDS = 3;
const SHARD_TTL = 24 * 3600_000;
const EXAMPLES = ['Jazz', 'Quadrivium', 'Byzantine Empire', 'Graph theory', 'Ice cutting', 'Octopus'];

interface Route {
  seeds: string[];
  r: Radius;
  a: string | null;
}

let route: Route = { seeds: [], r: 1, a: null };
let view: View | null = null;
let shown: number[] = [];
let lay: Layout | null = null;
let selected: number | null = null;
let hidden = new Set<Kind>();
let token = 0;
const shardCache = new Map<string, Promise<Shard>>();

/* ---------- routing ---------- */

declare const __BASE__: string;
/** Empty locally. `/small-wiki` when the site is a GitHub project page. */
const BASE = (__BASE__ || '').replace(/\/$/, '');
const homePath = `${BASE}/`;

const slug = (t: string) => encodeURIComponent(t.replace(/ /g, '_'));
function here(): string {
  const p = location.pathname;
  const rest = BASE && (p === BASE || p.startsWith(`${BASE}/`)) ? p.slice(BASE.length) : p;
  return rest.startsWith('/') ? rest : `/${rest}`;
}
function urlFor(r: Partial<Route>): string {
  const x = { ...route, ...r };
  const q = new URLSearchParams();
  if (x.r !== 1 && x.seeds.length) q.set('r', String(x.r));
  if (x.a) q.set('a', x.a);
  const qs = q.toString();
  const path = x.seeds.length ? `/wiki/${x.seeds.map(slug).join('+')}` : '/';
  return `${BASE}${path}${qs ? '?' + qs : ''}`;
}

function parseLocation(): Route {
  const m = here().match(/^\/wiki\/(.+)$/);
  const seeds = m
    ? m[1].split('+').map((s) => { try { return decodeURIComponent(s).replace(/_/g, ' '); } catch { return s; } }).filter(Boolean).slice(0, MAX_SEEDS)
    : [];
  const q = new URLSearchParams(location.search);
  const r = Math.min(3, Math.max(1, +(q.get('r') ?? 1) || 1)) as Radius;
  return { seeds, r, a: q.get('a') };
}

function navigate(next: Partial<Route>, replace = false) {
  const url = urlFor(next);
  const prevSeeds = route.seeds.join('|');
  route = { ...route, ...next };
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  if (route.seeds.join('|') !== prevSeeds) { selected = null; hidden = new Set(); }
  void render();
}

window.addEventListener('popstate', () => {
  route = parseLocation();
  selected = null;
  void render();
});

/* ---------- data ---------- */

function shardFor(title: string, onProgress: (p: number, msg: string) => void): Promise<Shard> {
  let p = shardCache.get(title);
  if (!p) {
    const cache = store<Shard>('sw:shard:v1:' + title, SHARD_TTL);
    const hit = cache.get();
    if (hit) p = Promise.resolve(hit);
    else {
      p = buildShard(title, (msg, pct) => onProgress(pct, msg)).then((s) => { cache.set(s); return s; });
      p.catch(() => shardCache.delete(title));
    }
    shardCache.set(title, p);
  }
  return p;
}

/* ---------- rendering ---------- */

async function render() {
  const my = ++token;
  window.scrollTo(0, 0);
  if (!route.seeds.length) return home();

  loading(route.seeds);
  try {
    const progress = route.seeds.map(() => 0);
    const msgs = route.seeds.map(() => '');
    const shards = await Promise.all(
      route.seeds.map((s, i) =>
        shardFor(s, (p, m) => {
          progress[i] = p;
          msgs[i] = m;
          if (my === token) setProgress(progress.reduce((a, b) => a + b, 0) / progress.length, msgs.find((x) => x && x !== 'Done') ?? '');
        }),
      ),
    );
    if (my !== token) return;
    // Canonical titles (redirects resolved) replace what was typed.
    const canon = shards.map((s) => s.seed.t);
    if (canon.join('|') !== route.seeds.join('|')) {
      route = { ...route, seeds: canon };
      history.replaceState(null, '', urlFor({}));
    }
    view = combine(shards);
    shown = neighborhood(view, route.r);
    lay = layout(view, shown);
    if (route.a) await article(route.a, my);
    else wiki(my);
  } catch (e) {
    if (my !== token) return;
    const msg = e instanceof SeedError ? e.message : 'Wikipedia could not be reached just now. Check your connection and try again.';
    app.innerHTML = `${topbar(false)}<div class="err"><h2>${esc(e instanceof SeedError ? 'That didn’t work' : 'Something went wrong')}</h2><p class="muted">${esc(msg)}</p><p><a class="btn primary" href="${homePath}" data-home>Start somewhere else</a></p></div>`;
    mountSearch();
    if (!(e instanceof SeedError)) console.error(e);
  }
}

function topbar(compact: boolean): string {
  return `<header class="top"><div class="wrap">
    <a class="brand" href="${homePath}" data-home aria-label="Small Wiki home"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-dasharray="0 4.5"/><path d="M16 16 L7.37 9.18 M16 16 L23.78 8.22 M16 16 L26.95 17 M16 16 L9.47 24.86 M16 16 L21.1 25.74 M7.37 9.18 L23.78 8.22 M23.78 8.22 L26.95 17 M9.47 24.86 L21.1 25.74" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="16" cy="16" r="3.3" fill="currentColor"/><circle cx="7.37" cy="9.18" r="2.2" fill="currentColor"/><circle cx="23.78" cy="8.22" r="2.2" fill="var(--c0)"/><circle cx="26.95" cy="17" r="2.2" fill="var(--red)"/><circle cx="9.47" cy="24.86" r="2.2" fill="var(--c2)"/><circle cx="21.1" cy="25.74" r="2.2" fill="currentColor"/></svg>Small Wiki</a>
    ${compact ? '' : `<div class="search" data-search></div>`}
    <a class="repo" href="https://github.com/nreff/small-wiki" target="_blank" rel="noopener noreferrer" aria-label="Small Wiki on GitHub"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.68 7.68 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg></a>
  </div></header>`;
}

function home() {
  document.title = 'Small Wiki';
  app.innerHTML = `${topbar(true)}
  <main class="wrap">
    <section class="hero">
      <h1>Make a wiki the size of your interest</h1>
      <p>Pick one to three articles. Small Wiki maps the neighborhood a few links away and builds a front page from only those articles.</p>
      <div class="search" data-search data-big></div>
      <div class="examples">${EXAMPLES.map((e) => `<a href="${urlFor({ seeds: [e], r: 1, a: null })}" data-seeds="${esc(e)}">${esc(e)}</a>`).join('')}
        <a href="${urlFor({ seeds: ['Juggling', 'Mathematics'], r: 1, a: null })}" data-seeds="Juggling|Mathematics">Juggling + Mathematics</a></div>
    </section>
    <div class="how">
      <div><b>Specific, not generic</b><span>Country, year and broad-field hub pages are down-weighted so the interesting articles show up.</span></div>
      <div><b>Grounded</b><span>Every fact comes from Wikipedia, with a link to the source article.</span></div>
      <div><b>Local reading</b><span>Open an article here and links between neighborhood articles stay inside your wiki.</span></div>
    </div>
    <footer>Content from Wikipedia and Wikimedia Commons, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.</footer>
  </main>`;
  mountSearch();
  (app.querySelector('.hero input') as HTMLInputElement | null)?.focus();
}

function loading(seeds: string[]) {
  document.title = `Building ${seeds.join(' + ')}… · Small Wiki`;
  app.innerHTML = `${topbar(true)}<div class="loading"><h2>Building a wiki around ${esc(seeds.join(' and '))}</h2>
    <div class="bar" role="progressbar" aria-label="Progress"><i id="bar"></i></div><p id="loadmsg">Starting…</p>
    <p class="small">First builds run live against Wikipedia and take a few seconds. Repeat visits are instant.</p></div>`;
}
function setProgress(p: number, msg: string) {
  const bar = document.getElementById('bar');
  if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  const m = document.getElementById('loadmsg');
  if (m && msg) m.textContent = msg + '…';
}

const seedColor = (i: number) => `var(--s${i})`;
const articleLink = (t: string, label = t) => `<a href="${urlFor({ a: t })}" data-art="${esc(t)}">${esc(label)}</a>`;

function wiki(my: number) {
  const v = view!;
  const names = v.seeds.map((s) => s.t);
  const title = names.join(' & ');
  document.title = `${title} Wiki · Small Wiki`;
  const count = shown.length + v.seeds.length;

  const chips = names
    .map((n, i) => `<span class="seedchip" style="--sc:${v.seeds.length > 1 ? seedColor(i) : 'var(--line)'}">${esc(n)}${names.length > 1 ? `<button type="button" data-drop="${i}" aria-label="Remove ${esc(n)}">×</button>` : ''}</span>`)
    .join('');

  app.innerHTML = `${topbar(false)}
  <main class="wrap">
    <section class="banner">
      <h1>Welcome to <em>${esc(title)}</em> Wiki</h1>
      <p>${count} articles within a few links, ${v.seeds.length > 1 ? 'where your interests meet and beyond' : 'built from what readers actually follow'}.</p>
      <div class="seeds">${chips}${names.length < MAX_SEEDS ? `<span class="muted small">Use “+ add” in search to combine up to ${MAX_SEEDS} interests.</span>` : ''}</div>
    </section>

    <section class="card mapcard" aria-label="Neighborhood map">
      <div class="controls">
        <div class="seg" role="group" aria-label="Radius">${([[1, 'Stay close'], [2, 'Wander further'], [3, 'Everything']] as const)
          .map(([r, l]) => `<button type="button" data-r="${r}" aria-pressed="${route.r === r}">${l}</button>`).join('')}</div>
        <div class="chips" id="chips" aria-label="Filter by kind"></div>
      </div>
      <div class="mapbox" id="map"></div>
      <div class="summary" id="summary"></div>
    </section>

    <div class="grid">
      <section class="card feat" id="featured"></section>
      <section class="card" id="dyk"></section>
      ${v.seeds.length > 1 ? `<section class="card wide" id="bridges"></section>` : ''}
      <section class="card" id="trending" hidden></section>
      <section class="card" id="years"></section>
    </div>

    <section class="block"><h2>Neighborhoods</h2><div class="portals" id="portals"></div></section>
    <section class="block"><h2>Every article, by distance</h2><div id="all"></div></section>
    <footer>Content from Wikipedia and Wikimedia Commons, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.</footer>
  </main>`;

  mountSearch();
  drawMap();
  fillFront();
  // After first paint: live sections.
  void trendingSection(my);
  if (v.seeds.length > 1 && v.bridges.length === 0) void liveBridges(my);
}

function drawMap() {
  const v = view!;
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  mapEl.innerHTML = renderMap(v, shown, lay!, { hidden, selected });
  document.getElementById('chips')!.innerHTML = kindChips(v, shown, hidden);
  drawSummary();
}

function drawSummary() {
  const v = view!;
  const el = document.getElementById('summary');
  if (!el) return;
  if (selected === null) {
    el.innerHTML = `<p class="muted">Select an article on the map to see how it connects. Inner rings are closest to ${esc(v.seeds.map((s) => s.t).join(' and '))}.</p>`;
    return;
  }
  const n = v.nodes[selected];
  const ringName = n.seed >= 0 ? 'Seed' : ['', 'Closest', 'Nearby', 'Further out'][n.ring];
  el.innerHTML = `<div><h3>${esc(n.t)}</h3><p>${esc(n.d || 'Wikipedia article')} · ${KIND_LABEL[n.k]} · ${ringName}</p></div>
    <div class="btns"><a class="btn primary" href="${urlFor({ a: n.t })}" data-art="${esc(n.t)}">Read here</a>
    ${n.seed < 0 ? `<a class="btn" href="${urlFor({ seeds: [n.t], r: 1, a: null })}" data-seeds="${esc(n.t)}">Build a wiki around this</a>` : ''}
    <a class="btn" href="${wikiUrl(n.t)}" target="_blank" rel="noopener noreferrer">Wikipedia ↗</a></div>`;
}

function fillFront() {
  const v = view!;
  const node = (i: number) => v.nodes[i];
  const set = (id: string, html: string) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };

  // From today's featured article: rotates daily among the top candidates.
  const featList = v.featured.filter((f) => shown.includes(f.n) || node(f.n).seed >= 0);
  const f = dailyPick(featList.length ? featList : v.featured);
  const today = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  set('featured', f
    ? `<h2>From today’s featured article</h2><div class="body">${node(f.n).img ? `<img class="thumb" src="${esc(node(f.n).img!)}" width="120" height="120" loading="lazy" alt="">` : ''}
      <h3>${articleLink(node(f.n).t)}</h3><p class="muted small">${today} · ${esc(node(f.n).d)}</p><p>${esc(f.text)}</p>
      <p class="small">${articleLink(node(f.n).t, 'Read the full article →')}</p></div>`
    : `<h2>From today’s featured article</h2><div class="body muted">No article in this neighborhood has a long enough introduction yet.</div>`);

  const hooks = v.dyk.filter((d) => shown.includes(d.n)).slice(0, 5);
  set('dyk', `<h2>Did you know…</h2><div class="body">${hooks.length ? `<ul>${hooks.map((d) => `<li>${articleLink(node(d.n).t)}: ${esc(d.text)}</li>`).join('')}</ul>` : '<span class="muted">Not enough quiet corners in this neighborhood.</span>'}</div>`);

  if (v.seeds.length > 1) bridgesHtml();

  const dated = shown.map((i) => i).filter((i) => node(i).y !== null && !hidden.has(node(i).k)).sort((a, b) => node(b).score - node(a).score).slice(0, 8).sort((a, b) => node(a).y! - node(b).y!);
  set('years', `<h2>Through the years</h2><div class="body">${dated.length >= 3
    ? `<ul>${dated.map((i) => `<li><span class="y">${node(i).y}</span>${articleLink(node(i).t)}<span class="muted small"> · ${esc(node(i).d)}</span></li>`).join('')}</ul><p class="muted small">Years are read from article descriptions until the Wikidata dates arrive.</p>`
    : '<span class="muted">Too few dated articles here.</span>'}</div>`);

  // Portal-style cluster lists.
  const byCl = new Map<string, number[]>();
  for (const i of shown) byCl.set(node(i).cl, [...(byCl.get(node(i).cl) ?? []), i]);
  const order = lay!.clusters;
  set('portals', order.map((name, ci) => {
    const members = (byCl.get(name) ?? []).sort((a, b) => node(b).score - node(a).score);
    return `<section class="card portal" style="--pc:var(--c${ci % PALETTE})"><h3>${esc(name || 'More')}</h3><div class="body"><ul>${members.slice(0, 12).map((i) => `<li>${articleLink(node(i).t)}</li>`).join('')}</ul>${members.length > 12 ? `<p class="muted small">+ ${members.length - 12} more below</p>` : ''}</div></section>`;
  }).join(''));

  const rings: [number, string][] = [[1, 'Closest'], [2, 'Nearby'], [3, 'Further out']];
  set('all', rings.map(([r, label]) => {
    const list = shown.filter((i) => node(i).ring === r).sort((a, b) => node(a).t.localeCompare(node(b).t));
    return list.length ? `<h3 class="ringh">${label} · ${list.length}</h3><ul class="cols">${list.map((i) => `<li><span class="dot" style="--dc:var(--c${Math.max(0, order.indexOf(node(i).cl)) % PALETTE})"></span>${articleLink(node(i).t)}</li>`).join('')}</ul>` : '';
  }).join(''));
}

let liveBridgeList: { t: string; d: string }[] = [];
function bridgesHtml() {
  const v = view!;
  const el = document.getElementById('bridges');
  if (!el) return;
  const items = v.bridges.map((i) => ({ t: v.nodes[i].t, d: v.nodes[i].d, per: v.nodes[i].per }));
  const live = items.length ? [] : liveBridgeList.map((b) => ({ ...b, per: [] as number[] }));
  const all = [...items, ...live];
  el.innerHTML = `<h2>Where your interests meet</h2><div class="body">${all.length
    ? `<ul>${all.map((b) => `<li>${b.per.length ? b.per.map((s, i) => `<span class="dot" style="--dc:${seedColor(i)};opacity:${s > 15 ? 1 : .25}" title="${esc(v.seeds[i].t)}"></span>`).join('') : ''}${articleLink(b.t)}<span class="muted small"> · ${esc(b.d)}</span></li>`).join('')}</ul>${live.length ? '<p class="muted small">Found with a live search for articles linking to both seeds.</p>' : ''}`
    : '<span class="muted">Looking for articles that link to both…</span>'}</div>`;
}

async function liveBridges(my: number) {
  const v = view!;
  if (v.seeds.length < 2) return;
  try {
    const q = v.seeds.map((s) => `linksto:"${s.t}"`).join(' ');
    const j = await api({ action: 'query', list: 'search', srsearch: q, srnamespace: 0, srlimit: 8, srprop: '' });
    const titles: string[] = (j.query?.search ?? []).map((x: any) => x.title).filter((t: string) => !v.seeds.some((s) => s.t === t));
    const { pages } = titles.length ? await basics(titles) : { pages: [] };
    if (my !== token) return;
    liveBridgeList = pages.filter((p) => !p.missing).slice(0, 6).map((p) => ({ t: p.title, d: p.desc }));
    bridgesHtml();
    const el = document.getElementById('bridges');
    if (el && !liveBridgeList.length) el.querySelector('.body')!.innerHTML = '<span class="muted">These interests are far apart; no single article links to both.</span>';
  } catch { /* leave the placeholder */ }
}

async function trendingSection(my: number) {
  const v = view!;
  const titles = shown.slice(0, 40).map((i) => v.nodes[i].t);
  const rows = await trending(titles);
  const el = document.getElementById('trending');
  if (my !== token || !el || rows.length < 2) return; // hidden if the call fails or nothing is trending
  el.hidden = false;
  el.innerHTML = `<h2>Trending in your neighborhood</h2><div class="body"><ul>${rows.map((r) => `<li>${articleLink(r.title)} <span class="muted small">· ${r.ratio.toFixed(1)}× its 60-day average, ${r.week.toLocaleString()} views this week</span></li>`).join('')}</ul></div>`;
}

async function article(title: string, my: number) {
  const v = view!;
  const names = v.seeds.map((s) => s.t).join(' & ');
  const local = new Set<string>([...v.nodes.map((n) => n.t)]);
  app.innerHTML = `${topbar(false)}<main class="wrap"><div class="crumb"><a class="btn" href="${urlFor({ a: null })}" data-back>← ${esc(names)} Wiki</a></div><div class="loading" style="margin:10vh auto"><h2>Opening ${esc(title)}…</h2></div></main>`;
  mountSearch();
  try {
    const a = await loadArticle(title, (t) => local.has(t));
    if (my !== token) return;
    const idx = v.nodes.findIndex((n) => n.t === a.title);
    document.title = `${a.title} · ${names} Wiki`;
    app.innerHTML = `${topbar(false)}<main class="wrap">
      <div class="crumb"><a class="btn" href="${urlFor({ a: null })}" data-back>← ${esc(names)} Wiki</a>
      ${idx >= v.seeds.length ? `<a class="btn" href="${urlFor({ seeds: [a.title], r: 1, a: null })}" data-seeds="${esc(a.title)}">Build a wiki around this</a>` : ''}
      <a class="btn" href="${wikiUrl(a.title)}" target="_blank" rel="noopener noreferrer">Wikipedia ↗</a></div>
      <article class="article"><h1>${esc(a.title)}</h1>${a.html}</article></main>`;
    mountSearch();
  } catch {
    if (my !== token) return;
    app.innerHTML = `${topbar(false)}<main class="wrap"><div class="err"><h2>Couldn’t open that article</h2><p><a class="btn" href="${urlFor({ a: null })}" data-back>Back to the wiki</a> <a class="btn" href="${wikiUrl(title)}" target="_blank" rel="noopener noreferrer">Open on Wikipedia ↗</a></p></div></main>`;
    mountSearch();
  }
}

/* ---------- search ---------- */

function mountSearch() {
  app.querySelectorAll<HTMLElement>('[data-search]').forEach((host) => {
    const canAdd = route.seeds.length > 0 && route.seeds.length < MAX_SEEDS && !!view;
    host.innerHTML = `<input type="search" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="sl" autocomplete="off" spellcheck="false" placeholder="${route.seeds.length ? 'Search a new wiki…' : 'Search Wikipedia for a seed article…'}" aria-label="Search for a seed article"><ul id="sl" role="listbox" hidden></ul>`;
    const input = host.querySelector('input')!;
    const list = host.querySelector('ul')!;
    let items: { title: string; desc: string }[] = [];
    let active = -1;
    let ctl: AbortController | null = null;
    let timer = 0;

    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const paint = () => {
      list.innerHTML = items.map((it, i) => `<li role="option" aria-selected="${i === active}" data-i="${i}"><span class="t">${esc(it.title)}</span><span class="d">${esc(it.desc)}</span>${canAdd ? `<button type="button" class="add" data-add="${i}" title="Combine with the current wiki">+ add</button>` : ''}</li>`).join('');
      list.hidden = items.length === 0;
      input.setAttribute('aria-expanded', String(items.length > 0));
    };
    const pick = (title: string, add: boolean) => {
      close();
      input.value = '';
      if (add && canAdd && !route.seeds.includes(title)) navigate({ seeds: [...route.seeds, title], a: null });
      else navigate({ seeds: [title], a: null, r: 1 });
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { items = []; paint(); return; }
      timer = window.setTimeout(async () => {
        ctl?.abort();
        ctl = new AbortController();
        try {
          items = await opensearch(q, ctl.signal);
          active = items.length ? 0 : -1;
          paint();
        } catch { /* aborted or offline */ }
      }, 120);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        paint();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = items[Math.max(active, 0)];
        const typed = input.value.trim();
        if (chosen) pick(chosen.title, e.shiftKey);
        else if (typed) pick(typed, e.shiftKey);
      } else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
    list.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const t = e.target as HTMLElement;
      const li = t.closest<HTMLElement>('li');
      if (li) pick(items[+li.dataset.i!].title, !!t.closest('[data-add]'));
    });
  });
}

/* ---------- events ---------- */

app.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const a = t.closest<HTMLElement>('[data-art]');
  const local = t.closest<HTMLElement>('[data-local]');
  const seeds = t.closest<HTMLElement>('[data-seeds]');
  const home_ = t.closest<HTMLElement>('[data-home]');
  const back = t.closest<HTMLElement>('[data-back]');
  const r = t.closest<HTMLElement>('[data-r]');
  const kind = t.closest<HTMLElement>('[data-kind]');
  const drop = t.closest<HTMLElement>('[data-drop]');
  const node = t.closest<SVGElement>('.node');
  if (e.metaKey || e.ctrlKey || e.shiftKey || (e as MouseEvent).button) return;

  if (a) { e.preventDefault(); navigate({ a: a.dataset.art! }); }
  else if (local) { e.preventDefault(); navigate({ a: local.dataset.local! }); }
  else if (seeds) { e.preventDefault(); navigate({ seeds: seeds.dataset.seeds!.split('|'), a: null, r: 1 }); }
  else if (home_) { e.preventDefault(); navigate({ seeds: [], a: null }); }
  else if (back) { e.preventDefault(); navigate({ a: null }); }
  else if (r) {
    route = { ...route, r: +r.dataset.r! as Radius };
    history.replaceState(null, '', urlFor({}));
    shown = neighborhood(view!, route.r);
    lay = layout(view!, shown);
    selected = null;
    wiki(token);
  } else if (kind) {
    const k = kind.dataset.kind as Kind;
    if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
    drawMap();
  } else if (drop) {
    e.preventDefault();
    navigate({ seeds: route.seeds.filter((_, i) => i !== +drop.dataset.drop!), a: null });
  } else if (node) {
    const i = +node.getAttribute('data-i')!;
    selected = selected === i ? null : i;
    drawMap();
  }
});

app.addEventListener('keydown', (e) => {
  const node = (e.target as HTMLElement).closest<SVGElement>('.node');
  if (node && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    const i = +node.getAttribute('data-i')!;
    selected = selected === i ? null : i;
    drawMap();
    app.querySelector<SVGElement>(`.node[data-i="${i}"]`)?.focus();
  }
});

route = parseLocation();
void render();
