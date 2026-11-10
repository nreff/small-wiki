import { api } from './api';
import { esc, wikiUrl } from './util';

const DROP = ['script', 'style', 'link', 'meta', '.mw-editsection', '.navbox', '.navbar', '.sistersitebox', '.noprint', '.mw-empty-elt', '.hatnote.navigation-not-searchable', 'noscript', 'iframe', 'object', 'form'].join(',');

export interface ArticleHtml {
  title: string;
  html: string;
}

/**
 * Wikipedia's own HTML for an article with links rewritten: neighborhood articles open inside
 * Small Wiki (via `data-local`), everything else goes to Wikipedia.
 */
export async function loadArticle(title: string, isLocal: (t: string) => boolean): Promise<ArticleHtml> {
  const j = await api({ action: 'parse', page: title, prop: 'text|displaytitle', redirects: 1, disableeditsection: 1, disablelimitreport: 1, disabletoc: 0, mobileformat: 0 });
  if (!j.parse) throw new Error('Could not load that article.');
  const doc = new DOMParser().parseFromString(j.parse.text, 'text/html');
  doc.querySelectorAll(DROP).forEach((e) => e.remove());
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
  }
  doc.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) return;
    const m = href.match(/^\/wiki\/([^#?]+)/);
    if (m && !decodeURIComponent(m[1]).includes(':')) {
      const t = decodeURIComponent(m[1]).replace(/_/g, ' ');
      if (isLocal(t)) {
        a.setAttribute('href', '#');
        a.setAttribute('data-local', t);
        a.classList.add('local');
        return;
      }
      a.setAttribute('href', wikiUrl(t));
    } else if (href.startsWith('/')) a.setAttribute('href', 'https://en.wikipedia.org' + href);
    else if (href.startsWith('//')) a.setAttribute('href', 'https:' + href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  doc.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    img.setAttribute('loading', 'lazy');
    const s = img.getAttribute('src');
    if (s?.startsWith('//')) img.setAttribute('src', 'https:' + s);
    img.removeAttribute('srcset');
  });
  const canonical: string = (j.parse.title as string) ?? title;
  return { title: canonical, html: doc.body.innerHTML + `<p class="attrib">Text from <a href="${esc(wikiUrl(canonical))}" target="_blank" rel="noopener noreferrer">Wikipedia: ${esc(canonical)}</a>, available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>. Authors are listed in the <a href="${esc(wikiUrl(canonical))}?action=history" target="_blank" rel="noopener noreferrer">page history</a>.</p>` };
}
