import type { Shard, View, VNode } from './types';

const FLOOR = 15; // a node missing from a shard counts as a small floor, not zero

/** Merge 1-3 shards into one view. Combined score is the geometric mean of per-seed scores. */
export function combine(shards: Shard[]): View {
  const seeds = shards.map((s) => ({ t: s.seed.t, d: s.seed.d, img: s.seed.img }));
  const index = new Map<string, number>();
  const nodes: VNode[] = [];
  const remap: number[][] = shards.map(() => []);

  const make = (n: Shard['nodes'][number], cluster: string): VNode => ({
    t: n.t, d: n.d, k: n.k, img: n.img, y: n.y, ring: n.r, score: 0, per: shards.map(() => 0), cl: cluster, seed: -1, present: 0,
  });

  shards.forEach((sh, si) => {
    const idx = index.get(sh.seed.t);
    if (idx === undefined) {
      index.set(sh.seed.t, nodes.length);
      nodes.push({ ...make(sh.nodes[0], ''), seed: si, ring: 0 });
    } else nodes[idx].seed = si;
  });
  const seedCount = nodes.length;
  // Seeds that coincide (same title) collapse; keep the order stable.
  shards.forEach((sh, si) => {
    sh.nodes.forEach((n, ni) => {
      let idx = index.get(n.t);
      if (idx === undefined) {
        idx = nodes.length;
        index.set(n.t, idx);
        nodes.push(make(n, n.c >= 0 ? sh.clusters[n.c].name : ''));
      }
      remap[si][ni] = idx;
      const v = nodes[idx];
      v.per[si] = Math.max(v.per[si], n.s);
      v.present++;
      if (v.seed < 0 && n.r > 0) v.ring = Math.min(v.ring || 9, n.r);
      if (!v.d && n.d) v.d = n.d;
      if (!v.img && n.img) v.img = n.img;
    });
  });

  // Scores are the geometric mean over seeds; a node's cluster comes from the seed it scores highest with.
  nodes.forEach((v, i) => {
    if (i < seedCount) {
      v.ring = 0;
      v.score = 1000;
      v.cl = '';
      return;
    }
    const prod = v.per.reduce((p, s) => p * Math.max(s, FLOOR), 1);
    v.score = Math.round(Math.pow(prod, 1 / shards.length));
    let best = 0;
    v.per.forEach((s, si) => { if (s > v.per[best]) best = si; });
    const sh = shards[best];
    const local = sh.nodes.findIndex((n) => n.t === v.t);
    v.cl = local > 0 && sh.nodes[local].c >= 0 ? sh.clusters[sh.nodes[local].c].name : v.cl;
  });
  const em = new Map<string, [number, number, number]>();
  shards.forEach((sh, si) => {
    for (const [a, b, w] of sh.edges) {
      const x = remap[si][a];
      const y = remap[si][b];
      const key = x < y ? `${x}-${y}` : `${y}-${x}`;
      const e = em.get(key);
      if (e) e[2] = Math.max(e[2], w);
      else em.set(key, [x, y, w]);
    }
  });
  const edges = [...em.values()];

  // Bridges: in at least two shards, or touching ring 1 of two different seeds.
  const reach: Set<number>[] = nodes.map(() => new Set());
  shards.forEach((sh, si) => {
    const ring1 = new Set(sh.nodes.map((n, ni) => (n.r <= 1 ? remap[si][ni] : -1)).filter((x) => x >= 0));
    for (const [a, b] of edges) {
      if (ring1.has(a)) reach[b].add(si);
      if (ring1.has(b)) reach[a].add(si);
    }
    for (const x of ring1) reach[x].add(si);
  });
  const bridges =
    shards.length < 2
      ? []
      : nodes
          .map((_, i) => i)
          .filter((i) => i >= seedCount && (nodes[i].present >= 2 || reach[i].size >= 2))
          .sort((a, b) => nodes[b].score - nodes[a].score)
          .slice(0, 6);

  const featured = interleave(shards.map((sh, si) => sh.featured.map((f) => ({ n: remap[si][f.n], text: f.text }))));
  const dyk = interleave(shards.map((sh, si) => sh.dyk.map((f) => ({ n: remap[si][f.n], text: f.text }))));
  return { seeds, nodes, edges, bridges, featured, dyk };
}

function interleave<T extends { n: number }>(lists: T[][]): T[] {
  const out: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; lists.some((l) => i < l.length); i++)
    for (const l of lists) if (i < l.length && !seen.has(l[i].n)) { seen.add(l[i].n); out.push(l[i]); }
  return out;
}
