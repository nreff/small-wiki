import type { Kind, View } from './types';
import { KIND_LABEL } from './kind';
import { esc } from './util';

export const SIZE = 1000;
const C = SIZE / 2;
const RING_R = [0, 165, 305, 440];
export const PALETTE = 8;

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export interface Layout {
  pos: Map<number, { x: number; y: number; ang: number }>;
  clusters: string[];
}

/** Deterministic layout: each cluster gets an angular sector sized by member count; rings sit at fixed radii. */
export function layout(view: View, shown: number[]): Layout {
  const pos: Layout['pos'] = new Map();
  const seedN = view.seeds.length;
  view.seeds.forEach((_, i) => {
    const a = (i / seedN) * Math.PI * 2 - Math.PI / 2;
    const r = seedN === 1 ? 0 : seedN === 2 ? 52 : 64;
    pos.set(i, { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r, ang: a });
  });
  const groups = new Map<string, number[]>();
  for (const i of shown) groups.set(view.nodes[i].cl, [...(groups.get(view.nodes[i].cl) ?? []), i]);
  const clusters = [...groups.keys()].sort(
    (a, b) => sum(groups.get(b)!.map((i) => view.nodes[i].score)) - sum(groups.get(a)!.map((i) => view.nodes[i].score)),
  );
  const total = shown.length || 1;
  let start = -Math.PI / 2;
  for (const name of clusters) {
    const members = groups.get(name)!;
    const span = (members.length / total) * Math.PI * 2;
    for (const ring of [1, 2, 3]) {
      const inRing = members.filter((i) => view.nodes[i].ring === ring).sort((a, b) => view.nodes[b].score - view.nodes[a].score);
      inRing.forEach((i, k) => {
        // Stagger rings by half a step so spokes don't line up.
        const a = start + ((k + 0.5 + (ring === 2 ? 0.18 : ring === 3 ? 0.36 : 0)) / inRing.length) * span;
        pos.set(i, { x: C + Math.cos(a) * RING_R[ring], y: C + Math.sin(a) * RING_R[ring], ang: a });
      });
    }
    start += span;
  }
  return { pos, clusters };
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export interface MapOpts {
  hidden: Set<Kind>;
  selected: number | null;
}

/** One SVG string, assigned to the DOM in a single write. */
export function renderMap(view: View, shown: number[], lay: Layout, o: MapOpts): string {
  const vis = new Set(shown.filter((i) => !o.hidden.has(view.nodes[i].k)));
  const seedN = view.seeds.length;
  for (let i = 0; i < seedN; i++) vis.add(i);
  const sel = o.selected;
  const near = new Set<number>();
  if (sel !== null) for (const [a, b] of view.edges) { if (a === sel) near.add(b); if (b === sel) near.add(a); }

  const parts: string[] = [];
  parts.push(`<svg viewBox="0 0 ${SIZE} ${SIZE}" role="group" aria-label="Neighborhood map" xmlns="http://www.w3.org/2000/svg">`);
  for (const r of [1, 2, 3]) parts.push(`<circle class="ring" cx="${C}" cy="${C}" r="${RING_R[r]}"/>`);

  parts.push('<g class="edges">');
  for (const [a, b, w] of view.edges) {
    const pa = lay.pos.get(a);
    const pb = lay.pos.get(b);
    if (!pa || !pb || !vis.has(a) || !vis.has(b)) continue;
    const hot = sel !== null && (a === sel || b === sel);
    const cls = hot ? 'edge hot' : sel !== null ? 'edge dim' : w >= 4 ? 'edge strong' : 'edge';
    parts.push(`<line class="${cls}" x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" stroke-width="${hot ? 1 + w * 0.35 : 0.6 + w * 0.2}"/>`);
  }
  parts.push('</g>');

  const colorOf = (i: number): string => {
    const n = view.nodes[i];
    if (n.seed >= 0) return `var(--s${n.seed})`;
    if (seedN > 1) {
      const tot = sum(n.per) || 1;
      const stops = n.per.map((s, si) => `var(--s${si}) ${((s / tot) * 100).toFixed(0)}%`);
      return `color-mix(in srgb, ${stops.join(', ')})`;
    }
    const ci = Math.max(0, lay.clusters.indexOf(n.cl));
    return `var(--c${ci % PALETTE})`;
  };

  const order = [...vis].sort((a, b) => a - b);
  let alt = 0;
  for (const i of order) {
    const n = view.nodes[i];
    const p = lay.pos.get(i);
    if (!p) continue;
    const isSeed = n.seed >= 0;
    const rad = isSeed ? 30 : 5.5 + (n.score / 1000) * 6;
    const cls = ['node', isSeed ? 'seed' : `ring${n.ring}`, sel === i ? 'sel' : '', sel !== null && sel !== i && !near.has(i) ? 'faint' : ''].filter(Boolean).join(' ');
    let label: string;
    if (isSeed) {
      const ly = seedN === 1 ? 48 : 40;
      label = `<text class="lbl seedlbl" y="${p.y > C + 5 ? ly : -ly + 8}" text-anchor="middle">${esc(trunc(n.t, 26))}</text>`;
    } else {
      const off = rad + 7 + (alt++ % 2) * 15;
      const c = Math.cos(p.ang);
      const side = Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end';
      const lx = Math.cos(p.ang) * off;
      const ly = Math.sin(p.ang) * off + 4;
      label = `<text class="lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${side}">${esc(trunc(n.t, n.ring === 1 ? 24 : 20))}</text>`;
    }
    parts.push(
      `<g class="${cls}" data-i="${i}" tabindex="0" role="button" aria-label="${esc(n.t)}${n.d ? ', ' + esc(n.d) : ''}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">` +
        `<circle r="${rad.toFixed(1)}" style="fill:${colorOf(i)}"/>${isSeed ? '' : ''}${label}</g>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

export function kindChips(view: View, shown: number[], hidden: Set<Kind>): string {
  const counts = new Map<Kind, number>();
  for (const i of shown) counts.set(view.nodes[i].k, (counts.get(view.nodes[i].k) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => `<button type="button" class="chip kind-${k}" data-kind="${k}" aria-pressed="${!hidden.has(k)}">${KIND_LABEL[k]} <span>${c}</span></button>`)
    .join('');
}
