import { pool } from './api';
import { store } from './util';

export interface Trend {
  title: string;
  ratio: number;
  week: number;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Top 5 by 7-day views ÷ 60-day daily average, from the live Pageviews API. Returns [] on failure. */
export async function trending(titles: string[]): Promise<Trend[]> {
  const key = 'sw:trend:' + titles.slice(0, 12).join('|');
  const cache = store<Trend[]>(key, 3600_000);
  const hit = cache.get();
  if (hit) return hit;
  const end = new Date(Date.now() - 86400_000);
  const start = new Date(end.getTime() - 59 * 86400_000);
  try {
    const rows = await pool(titles, 6, async (t) => {
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(t.replace(/ /g, '_'))}/daily/${ymd(start)}/${ymd(end)}`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const items: { views: number }[] = (await r.json()).items ?? [];
      if (items.length < 14) return null;
      const all = items.reduce((s, x) => s + x.views, 0) / items.length;
      const week = items.slice(-7).reduce((s, x) => s + x.views, 0);
      return all < 5 ? null : { title: t, ratio: week / 7 / all, week };
    });
    const out = rows.filter((x): x is Trend => !!x && x.ratio > 1.1).sort((a, b) => b.ratio - a.ratio).slice(0, 5);
    cache.set(out);
    return out;
  } catch {
    return [];
  }
}
