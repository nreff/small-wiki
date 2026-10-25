export type Kind = 'person' | 'work' | 'place' | 'org' | 'concept' | 'event' | 'object';
export const KINDS: Kind[] = ['person', 'work', 'place', 'org', 'concept', 'event', 'object'];

/** One article in a seed's neighborhood. Field names follow the shard format in the spec. */
export interface SNode {
  t: string; // title
  d: string; // short description
  k: Kind;
  r: number; // ring 0 (seed), 1-3
  s: number; // score 0-1000
  c: number; // cluster index, -1 for the seed
  img: string | null;
  y: number | null;
}

/** Shard v1: everything the front page needs for one seed. Node 0 is the seed. */
export interface Shard {
  v: 1;
  seed: { t: string; d: string; img: string | null; q: string | null };
  nodes: SNode[];
  edges: [number, number, number][]; // from, to, weight 0-9
  clusters: { name: string; lead: number }[];
  featured: { n: number; text: string }[];
  dyk: { n: number; text: string }[];
  built: number; // epoch ms, live prototype only
}

export interface VNode {
  t: string;
  d: string;
  k: Kind;
  img: string | null;
  y: number | null;
  ring: number; // 0 for seeds
  score: number; // combined 0-1000
  per: number[]; // score per seed
  cl: string; // cluster name
  seed: number; // seed index, or -1
  present: number; // number of shards containing the node
}

export interface View {
  seeds: { t: string; d: string; img: string | null }[];
  nodes: VNode[]; // seeds first
  edges: [number, number, number][];
  bridges: number[];
  featured: { n: number; text: string }[];
  dyk: { n: number; text: string }[];
}

export type Progress = (msg: string, pct: number) => void;
