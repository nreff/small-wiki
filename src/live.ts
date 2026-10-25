// Live prototype of pipeline stages 2-8, run in the browser against the Action API.
// The Rust pipeline replaces this with PPR over the full graph; the shard it produces is the same shape.
import { api, basics, chunk, extracts, pool } from './api';
import { kindOf, yearOf } from './kind';
import { proseLinks } from './prose';
import type { Progress, Shard, SNode } from './types';
import { hash01 } from './util';

const HUB_TITLE =
  /^(List|Lists|Outline|Index|Glossary|Bibliography) of |\(identifier\)$|^(\d{1,4}s?( BC| AD)?|\d{1,2}(st|nd|rd|th) (century|millennium)( BC)?|(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2})$/;
const POOL_CAP = 1500;
const BASE_SET = 60; // articles whose own links are used for co-citation
const RERANK = 56; // candidates that get an in-degree lookup
const KEEP = 60;
const RING1_MAX = 18;
const RING2_MAX = 24;
const HUB_INLINKS = 40000;
const HUB_EXP = 0.35; // spec says 0.5 on PPR mass; additive live scores are flatter, so the penalty is gentler here

export class SeedError extends Error {}

interface Cand {
  t: string;
  direct: boolean; // seed links to it in prose (or anywhere, for tiny articles)
  prom: number; // prominence of that link: repeats and early mentions
  mutual: boolean; // it links back
  ml: number; // morelike rank (0 = best), -1 if absent
  s0: number;
  cocite: number;
  raw: number;
  inl: number;
  score: number;
}

async function resolveSeed(input: string) {
  const { pages } = await basics([input]);
  const p = pages[0];
  if (!p || p.missing) throw new SeedError(`Wikipedia has no article called “${input}”.`);
  if (p.disambig) throw new SeedError(`“${p.title}” is a disambiguation page. Pick a specific article.`);
  return p;
}

/** Seed's outgoing article links, with a mutual flag from one generator query (prop=links&pltitles=seed). */
async function seedLinks(seed: string) {
  const out = new Map<string, { mutual: boolean; ok: boolean }>();
  let cont: Record<string, string> = {};
  for (let i = 0; i < 4; i++) {
    const j = await api({
      action: 'query', generator: 'links', titles: seed, gplnamespace: 0, gpllimit: 'max', redirects: 1,
      prop: 'links|pageprops', pltitles: seed, pllimit: 'max', ppprop: 'disambiguation', ...cont,
    });
    for (const p of j.query?.pages ?? []) {
      if (p.missing) continue; // red link
      const e = out.get(p.title) ?? { mutual: false, ok: true };
      if (p.pageprops?.disambiguation !== undefined) e.ok = false;
      if (p.links?.length) e.mutual = true;
      out.set(p.title, e);
    }
    if (!j.continue) break;
    cont = j.continue;
  }
  return out;
}

async function moreLike(seed: string): Promise<string[]> {
  const j = await api({ action: 'query', list: 'search', srsearch: `morelike:${seed}`, srnamespace: 0, srlimit: 50, srprop: '' });
  return (j.query?.search ?? []).map((x: any) => x.title as string);
}

/** Outgoing article links for several titles at once; one request returns up to 500 links in total, so follow `continue`. */
async function outlinksOf(titles: string[], into: Map<string, Set<string>>): Promise<void> {
  let cont: Record<string, string> = {};
  for (let i = 0; i < 12; i++) {
    const j = await api({ action: 'query', titles: titles.join('|'), prop: 'links', pllimit: 'max', plnamespace: 0, ...cont });
    for (const p of j.query?.pages ?? []) {
      const set = into.get(p.title) ?? new Set<string>();
      for (const l of p.links ?? []) set.add(l.title);
      into.set(p.title, set);
    }
    if (!j.continue) break;
    cont = j.continue;
  }
}

async function outlinksAll(titles: string[], into: Map<string, Set<string>>, step: () => void) {
  await pool(chunk(titles, 12), 4, async (part) => {
    await outlinksOf(part, into);
    step();
  });
}

async function inlinkCount(title: string): Promise<number> {
  if (title.includes('"')) return 1000;
  try {
    const j = await api({ action: 'query', list: 'search', srsearch: `linksto:"${title}"`, srnamespace: 0, srlimit: 1, srinfo: 'totalhits', srprop: '' });
    return j.query?.searchinfo?.totalhits ?? 1000;
  } catch {
    return 1000;
  }
}

/** Louvain phase 1 on the induced subgraph (seed excluded), then merge tiny clusters. */
function cluster(n: number, edges: [number, number, number][], score: number[]): number[] {
  const adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  let m2 = 0;
  for (const [a, b, w] of edges) {
    if (a === 0 || b === 0 || a === b) continue;
    adj[a].set(b, (adj[a].get(b) ?? 0) + w);
    adj[b].set(a, (adj[b].get(a) ?? 0) + w);
    m2 += 2 * w;
  }
  const deg = adj.map((m) => [...m.values()].reduce((x, y) => x + y, 0));
  const com = Array.from({ length: n }, (_, i) => i);
  const tot = deg.slice();
  const order = Array.from({ length: n - 1 }, (_, i) => i + 1).sort((a, b) => score[b] - score[a]);
  if (m2 > 0) {
    for (let pass = 0; pass < 20; pass++) {
      let moved = false;
      for (const i of order) {
        const links = new Map<number, number>();
        for (const [j, w] of adj[i]) links.set(com[j], (links.get(com[j]) ?? 0) + w);
        tot[com[i]] -= deg[i];
        let best = com[i];
        let bestGain = (links.get(com[i]) ?? 0) - (tot[com[i]] * deg[i]) / m2;
        for (const [c, w] of links) {
          const gain = w - (tot[c] * deg[i]) / m2;
          if (gain > bestGain + 1e-9 || (Math.abs(gain - bestGain) <= 1e-9 && c < best && gain > 0)) { best = c; bestGain = gain; }
        }
        tot[best] += deg[i];
        if (best !== com[i]) { com[i] = best; moved = true; }
      }
      if (!moved) break;
    }
  }
  // Merge clusters smaller than 3, and cap at 8 clusters, into the best-connected neighbor.
  const members = () => {
    const g = new Map<number, number[]>();
    for (const i of order) g.set(com[i], [...(g.get(com[i]) ?? []), i]);
    return g;
  };
  for (;;) {
    const g = members();
    const sorted = [...g.entries()].sort((a, b) => a[1].length - b[1].length);
    const [smallId, small] = sorted[0] ?? [];
    if (smallId === undefined || (small.length >= 3 && g.size <= 8) || g.size <= 1) break;
    const pull = new Map<number, number>();
    for (const i of small) for (const [j, w] of adj[i]) if (com[j] !== smallId) pull.set(com[j], (pull.get(com[j]) ?? 0) + w);
    let target = [...pull.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (target === undefined) target = sorted[sorted.length - 1][0];
    if (target === smallId) break;
    for (const i of small) com[i] = target;
  }
  return com;
}

export async function buildShard(input: string, onProgress: Progress = () => {}): Promise<Shard> {
  const seed = await resolveSeed(input);
  const seedTitle = seed.title;

  onProgress(`Reading links from ${seedTitle}`, 0.08);
  const [links, ml, prose] = await Promise.all([
    seedLinks(seedTitle),
    moreLike(seedTitle),
    proseLinks(seedTitle).catch(() => []),
  ]);

  // Prose links name the real neighborhood; links that only appear in navboxes are noise (every biology
  // discipline links every other). Map prose titles through redirects onto the canonical link set.
  const prominence = new Map<string, number>();
  const unresolved: string[] = [];
  const bump = (t: string, p: { count: number; first: number }) => {
    const v = 1 + Math.min(p.count - 1, 3) * 0.4 + (p.first < 0.3 ? 0.6 : 0);
    prominence.set(t, Math.max(prominence.get(t) ?? 0, v));
  };
  for (const p of prose) {
    if (links.has(p.title)) bump(p.title, p);
    else unresolved.push(p.title);
  }
  const alias = new Map(prose.map((p) => [p.title, p]));
  await pool(chunk(unresolved.slice(0, 150), 50), 3, async (part) => {
    const { pages, redirects } = await basics(part);
    const ok = new Set(pages.filter((p) => !p.missing && !p.disambig).map((p) => p.title));
    for (const t of part) {
      const canon = redirects.get(redirects.get(t) ?? t) ?? redirects.get(t) ?? t;
      if (ok.has(canon) && links.has(canon)) bump(canon, alias.get(t)!);
    }
  });
  const tiny = prominence.size < 25; // short articles: fall back to every link

  // Candidate pool: direct links plus morelike neighbors, minus hub-shaped titles.
  const pool_ = new Map<string, Cand>();
  const add = (t: string) => {
    let c = pool_.get(t);
    if (!c) pool_.set(t, (c = { t, direct: false, prom: 0, mutual: false, ml: -1, s0: 0, cocite: 0, raw: 0, inl: 0, score: 0 }));
    return c;
  };
  for (const [t, e] of links) {
    if (t === seedTitle || !e.ok || HUB_TITLE.test(t)) continue;
    const c = add(t);
    c.prom = prominence.get(t) ?? 0;
    c.direct = c.prom > 0 || tiny;
    if (tiny && c.prom === 0) c.prom = 0.5;
    c.mutual = e.mutual;
  }
  ml.forEach((t, i) => {
    if (t === seedTitle || HUB_TITLE.test(t)) return;
    add(t).ml = i;
  });
  if (pool_.size === 0) throw new SeedError(`“${seedTitle}” has too few links to build a wiki around.`);
  for (const c of pool_.values()) {
    c.s0 = c.prom + (c.mutual ? 3 : 0) + (c.ml >= 0 ? 1 + 2 * (1 - c.ml / Math.max(ml.length, 1)) : 0);
  }
  let cands = [...pool_.values()].sort((a, b) => b.s0 - a.s0 || hash01(a.t) - hash01(b.t));
  if (cands.length > POOL_CAP) cands = cands.slice(0, POOL_CAP);

  // Co-citation: how many strong neighbors link to each candidate, down-weighted by their out-degree.
  const base = cands.slice(0, BASE_SET);
  onProgress('Following links between neighbors', 0.2);
  let done = 0;
  const links_ = new Map<string, Set<string>>();
  await outlinksAll(base.map((b) => b.t), links_, () =>
    onProgress('Following links between neighbors', 0.2 + 0.3 * (++done / Math.ceil(base.length / 12))),
  );
  const byTitle = new Map(cands.map((c) => [c.t, c]));
  for (const b of base) {
    const out = links_.get(b.t)!;
    const w = 1 / Math.sqrt(Math.max(out.size, 1));
    for (const t of out) {
      const c = byTitle.get(t);
      if (c && c !== b) c.cocite += w;
    }
    if (out.has(seedTitle)) b.mutual = true;
  }
  const maxCo = Math.max(...cands.map((c) => c.cocite), 1e-9);
  for (const c of cands) c.raw = c.s0 + 4 * (c.cocite / maxCo);

  // Hub penalty: score / in-degree^0.5, looked up only for the best candidates.
  onProgress('Down-weighting generic hub pages', 0.52);
  const top = [...cands].sort((a, b) => b.raw - a.raw).slice(0, RERANK);
  done = 0;
  await pool(top, 4, async (c) => {
    c.inl = await inlinkCount(c.t);
    onProgress('Down-weighting generic hub pages', 0.52 + 0.2 * (++done / top.length));
  });
  for (const c of top) {
    const hub = c.inl > HUB_INLINKS ? 0.4 : 1;
    c.score = (c.raw / Math.pow(Math.max(c.inl, 100), HUB_EXP)) * hub;
  }
  const chosen = top.sort((a, b) => b.score - a.score).slice(0, KEEP);
  const maxScore = chosen[0].score || 1;

  // Nodes: seed first, then by score. Edges come from outgoing links among the chosen set.
  onProgress('Drawing the map', 0.75);
  const idx = new Map<string, number>([[seedTitle, 0]]);
  chosen.forEach((c, i) => idx.set(c.t, i + 1));
  const needOut = chosen.filter((c) => !links_.has(c.t));
  await outlinksAll(needOut.map((c) => c.t), links_, () => {});

  const edgeMap = new Map<string, [number, number, number]>();
  const addEdge = (a: number, b: number, w: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const e = edgeMap.get(key);
    if (e) e[2] = Math.min(9, e[2] + w);
    else edgeMap.set(key, [a, b, Math.min(9, w)]);
  };
  for (const c of chosen) {
    const i = idx.get(c.t)!;
    if (c.direct) addEdge(0, i, 3);
    if (c.mutual || links_.get(c.t)?.has(seedTitle)) addEdge(i, 0, 3);
    for (const t of links_.get(c.t) ?? []) {
      const j = idx.get(t);
      if (j !== undefined && j !== 0 && j !== i) addEdge(i, j, 1);
    }
  }
  const edges = [...edgeMap.values()];

  // Rings: ring 1 = best directly linked (max 18), ring 2 = touches ring 1, ring 3 = the rest.
  const ring = new Array<number>(chosen.length + 1).fill(3);
  ring[0] = 0;
  let r1 = 0;
  chosen.forEach((c, i) => {
    if ((c.direct || c.mutual) && r1 < RING1_MAX) { ring[i + 1] = 1; r1++; }
  });
  const nb: Set<number>[] = Array.from({ length: ring.length }, () => new Set());
  for (const [a, b] of edges) { nb[a].add(b); nb[b].add(a); }
  // Ring 2 = the best remaining nodes that touch ring 1; everything else is ring 3.
  let r2 = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i] === 3 && r2 < RING2_MAX && [...nb[i]].some((j) => ring[j] === 1)) { ring[i] = 2; r2++; }
  }

  const scores = [1000, ...chosen.map((c) => Math.max(1, Math.round((c.score / maxScore) * 1000)))];
  const com = cluster(ring.length, edges, scores);
  const groups = new Map<number, number[]>();
  for (let i = 1; i < ring.length; i++) groups.set(com[i], [...(groups.get(com[i]) ?? []), i]);
  const ordered = [...groups.values()].sort((a, b) => b.reduce((s, i) => s + scores[i], 0) - a.reduce((s, i) => s + scores[i], 0));
  const clusterOf = new Array<number>(ring.length).fill(-1);
  const clusters = ordered.map((members, ci) => {
    members.forEach((i) => (clusterOf[i] = ci));
    const lead = members.reduce((best, i) => (scores[i] > scores[best] ? i : best), members[0]);
    return { name: chosen[lead - 1].t, lead };
  });

  // Enrich with descriptions, thumbnails and kinds.
  onProgress('Adding descriptions and images', 0.85);
  const titles = chosen.map((c) => c.t);
  const info = new Map<string, Awaited<ReturnType<typeof basics>>['pages'][number]>();
  await pool(chunk(titles, 50), 3, async (part) => {
    for (const p of (await basics(part)).pages) info.set(p.title, p);
  });
  const nodes: SNode[] = [
    { t: seedTitle, d: seed.desc, k: kindOf(seed.desc), r: 0, s: 1000, c: -1, img: seed.img, y: yearOf(seed.desc) },
    ...chosen.map((c, i): SNode => {
      const p = info.get(c.t);
      const d = p?.desc ?? '';
      return { t: c.t, d, k: kindOf(d), r: ring[i + 1], s: scores[i + 1], c: clusterOf[i + 1], img: p?.img ?? null, y: yearOf(d) };
    }),
  ];

  // Featured article candidates and "Did you know" fallback hooks (first sentences of quiet, relevant neighbors).
  onProgress('Choosing a featured article', 0.93);
  const featPool = nodes.map((n, i) => [n, i] as const).filter(([n]) => n.r === 1 || n.r === 2).slice(0, 14);
  const [intro, hookText] = await Promise.all([
    extracts(featPool.map(([n]) => n.t), { chars: 1100 }),
    (async () => {
      const quiet = chosen
        .map((c, i) => ({ c, i: i + 1 }))
        .filter(({ c, i }) => ring[i] >= 2 && c.inl < 3000)
        .slice(0, 8);
      return { quiet, text: await extracts(quiet.map(({ c }) => c.t), { sentences: 1 }) };
    })(),
  ]);
  const firstPara = (s: string) => {
    const p = s.split('\n').find((x) => x.trim().length > 60) ?? s;
    return p.length > 620 ? p.slice(0, 620).replace(/\s+\S*$/, '') + '…' : p;
  };
  const featured = featPool
    .filter(([n]) => (intro.get(n.t)?.length ?? 0) > 400)
    .sort((a, b) => Number(!!b[0].img) - Number(!!a[0].img) || b[0].s - a[0].s)
    .slice(0, 5)
    .map(([n, i]) => ({ n: i, text: firstPara(intro.get(n.t)!) }));
  const dyk = hookText.quiet
    .filter(({ c }) => (hookText.text.get(c.t)?.length ?? 0) > 40)
    .slice(0, 5)
    .map(({ c, i }) => ({ n: i, text: hookText.text.get(c.t)!.replace(/\s*\([^()]*\)/g, '').trim() }));

  onProgress('Done', 1);
  return { v: 1, seed: { t: seedTitle, d: seed.desc, img: seed.img, q: seed.q }, nodes, edges, clusters, featured, dyk, built: Date.now() };
}
