import { sleep } from './util';

const API = 'https://en.wikipedia.org/w/api.php';
type Params = Record<string, string | number | boolean>;

// Wikipedia rate-limits bursts, so every call goes through one small gate.
const MAX_INFLIGHT = 4;
let inflight = 0;
const waiting: (() => void)[] = [];
async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) await new Promise<void>((r) => waiting.push(r));
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    waiting.shift()?.();
  }
}

/** Action API call with JSON v2, CORS and a couple of retries (search can be briefly busy). */
export async function api(p: Params, signal?: AbortSignal): Promise<any> {
  const q = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*' });
  for (const [k, v] of Object.entries(p)) q.set(k, String(v));
  const url = `${API}?${q}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await gate(() => fetch(url, { signal }));
      if (r.status === 429 || r.status === 503) {
        const wait = Math.min(+(r.headers.get('retry-after') ?? 0) || 1, 5);
        await sleep(wait * 1000);
        throw new Error('HTTP ' + r.status);
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error.info || j.error.code);
      return j;
    } catch (e) {
      if (signal?.aborted || attempt >= 4) throw e;
      await sleep(250 * (attempt + 1));
    }
  }
}

/** Run fn over items with at most n in flight, keeping result order. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export const chunk = <T>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

export interface Basic {
  title: string;
  desc: string;
  img: string | null;
  q: string | null;
  missing: boolean;
  disambig: boolean;
}

/** Descriptions, lead images and Wikidata ids for up to 50 titles; follows redirects. */
export async function basics(titles: string[], signal?: AbortSignal): Promise<{ pages: Basic[]; redirects: Map<string, string> }> {
  const j = await api(
    {
      action: 'query',
      titles: titles.join('|'),
      redirects: 1,
      prop: 'pageprops|description|pageimages',
      ppprop: 'disambiguation|wikibase_item',
      piprop: 'thumbnail',
      pithumbsize: 240,
      pilimit: 'max',
    },
    signal,
  );
  const redirects = new Map<string, string>();
  for (const x of j.query?.normalized ?? []) redirects.set(x.from, x.to);
  for (const x of j.query?.redirects ?? []) redirects.set(x.from, x.to);
  const pages: Basic[] = (j.query?.pages ?? []).map((p: any) => ({
    title: p.title,
    desc: p.description ?? '',
    img: p.thumbnail?.source ?? null,
    q: p.pageprops?.wikibase_item ?? null,
    missing: !!(p.missing || p.invalid),
    disambig: p.pageprops?.disambiguation !== undefined,
  }));
  return { pages, redirects };
}

/** Plain-text intro extracts. `sentences` > 0 limits by sentences, otherwise by characters. */
export async function extracts(titles: string[], opts: { sentences?: number; chars?: number }, signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunk(titles, 20)) {
    const p: Params = { action: 'query', titles: part.join('|'), prop: 'extracts', exintro: 1, explaintext: 1, exlimit: 'max' };
    if (opts.sentences) p.exsentences = opts.sentences;
    else p.exchars = opts.chars ?? 1200;
    const j = await api(p, signal);
    for (const pg of j.query?.pages ?? []) if (pg.extract) out.set(pg.title, pg.extract);
  }
  return out;
}

export async function opensearch(q: string, signal?: AbortSignal): Promise<{ title: string; desc: string }[]> {
  const j = await api({ action: 'query', generator: 'prefixsearch', gpssearch: q, gpslimit: 8, gpsnamespace: 0, redirects: 1, prop: 'description', }, signal);
  const pages: any[] = j.query?.pages ?? [];
  return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((p) => ({ title: p.title, desc: p.description ?? '' }));
}
