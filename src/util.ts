export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** Deterministic string hash in [0, 1), for stable tie-breaking. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export const wikiUrl = (title: string) =>
  'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':');

export function store<T>(key: string, ttlMs: number): { get(): T | null; set(v: T): void } {
  return {
    get() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const { t, v } = JSON.parse(raw);
        return Date.now() - t < ttlMs ? (v as T) : null;
      } catch {
        return null;
      }
    },
    set(v: T) {
      try {
        localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
      } catch {
        /* storage full or blocked: caching is optional */
      }
    },
  };
}
