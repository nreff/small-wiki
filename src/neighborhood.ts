import type { Kind, View } from './types';

export type Radius = 1 | 2 | 3;

/** Setting → [max ring, articles shown] (per spec). More seeds show proportionally more. */
export function radiusRule(r: Radius, seeds: number): { maxRing: number; count: number } {
  const [maxRing, count] = r === 1 ? [2, 25] : r === 2 ? [3, 45] : [3, 60];
  return { maxRing, count: Math.round(count * Math.pow(seeds, 0.7)) };
}

const VARIETY_CAP = 0.4;

/** Indices of the non-seed nodes to show: top N by score within the rings, with no kind above 40%. */
export function neighborhood(view: View, r: Radius): number[] {
  const seedCount = view.seeds.length;
  const { maxRing, count } = radiusRule(r, seedCount);
  const pool = view.nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n, i }) => i >= seedCount && n.ring <= maxRing)
    .sort((a, b) => b.n.score - a.n.score);
  const shown = pool.slice(0, count);
  const rest = pool.slice(count);
  const cap = Math.max(1, Math.floor(shown.length * VARIETY_CAP));
  const tally = (k: Kind) => shown.filter((x) => x.n.k === k).length;
  // Swap the lowest-scoring members of an over-represented kind for the next-best nodes of other kinds.
  for (let guard = 0; guard < 200; guard++) {
    const over = (['person', 'work', 'place', 'org', 'concept', 'event', 'object'] as Kind[]).find((k) => tally(k) > cap);
    if (!over) break;
    const out = shown.map((x, p) => [x, p] as const).filter(([x]) => x.n.k === over).pop();
    const inn = rest.findIndex((x) => x.n.k !== over && tally(x.n.k) < cap);
    if (!out || inn < 0) break;
    const [replacement] = rest.splice(inn, 1);
    shown[out[1]] = replacement;
  }
  return shown.sort((a, b) => b.n.score - a.n.score).map((x) => x.i);
}

/** Featured article rotates daily among the top candidates, seeded by the date. */
export function dailyPick<T>(items: T[], date = new Date()): T | undefined {
  if (!items.length) return undefined;
  const day = Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
  return items[day % Math.min(items.length, 5)];
}
