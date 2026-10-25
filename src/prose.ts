import { api } from './api';

export interface ProseLink {
  title: string;
  count: number; // times linked in the prose
  first: number; // 0-1, position of first mention
}

const DROP = [
  '.navbox', '.sidebar', '.vertical-navbox', '.reflist', '.references', '.mw-references-wrap', '.hatnote',
  '.shortdescription', '.noprint', '.metadata', '.ambox', '.authority-control', '.sistersitebox', '.portal-bar',
  'style', 'script', 'sup.reference', '.mw-editsection', '.toc',
].join(',');
const STOP = new Set(['References', 'External_links', 'Notes', 'Further_reading', 'Bibliography', 'Sources', 'Citations', 'Footnotes']);

/** Links in an article's rendered prose, outside navboxes, sidebars and the reference sections. */
export async function proseLinks(title: string): Promise<ProseLink[]> {
  const j = await api({ action: 'parse', page: title, prop: 'text', redirects: 1, disableeditsection: 1, disablelimitreport: 1, disabletoc: 1 });
  const doc = new DOMParser().parseFromString(j.parse?.text ?? '', 'text/html');
  const root = doc.querySelector('.mw-parser-output') ?? doc.body;
  root.querySelectorAll(DROP).forEach((e) => e.remove());

  const found = new Map<string, { count: number; at: number }>();
  let n = 0;
  let total = 0;
  const anchors: HTMLAnchorElement[] = [];
  for (const child of Array.from(root.children)) {
    const h = child.matches('h2') ? child : child.querySelector(':scope > h2');
    if (h && STOP.has(h.id)) break;
    anchors.push(...Array.from(child.querySelectorAll<HTMLAnchorElement>('a[href^="/wiki/"]')));
  }
  total = anchors.length || 1;
  for (const a of anchors) {
    const path = a.getAttribute('href')!.slice(6).split('#')[0];
    if (!path || path.includes(':')) {
      n++;
      continue;
    }
    let t: string;
    try {
      t = decodeURIComponent(path).replace(/_/g, ' ');
    } catch {
      continue;
    }
    const e = found.get(t);
    if (e) e.count++;
    else found.set(t, { count: 1, at: n / total });
    n++;
  }
  return [...found].map(([t, v]) => ({ title: t, count: v.count, first: v.at }));
}
