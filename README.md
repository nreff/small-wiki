# Small Wikipedia

Turn any interest into a self-contained mini Wikipedia: a ring map of the articles a few links away, plus a front page built only from them.

Pick one to three English Wikipedia articles as seeds. Small Wikipedia finds the neighborhood around them, down-weights generic hub pages (countries, years, broad fields) so the interesting material shows up, and lays it out as a map and a Wikipedia-style front page. Every fact comes from Wikipedia, with a link to the source article. No LLM is involved at any step.

> **Status: milestone 1, the live prototype.** Neighborhoods are computed in your browser from the Wikipedia API, so a first build takes several seconds. The full design (offline Rust pipeline, static shards on a CDN, sub-100 ms loads) is in [`Small Wikipedia Technical Spec.md`](<Small Wikipedia Technical Spec.md>).

## Quick start

Requires Node 20+.

```sh
npm install
npm run dev        # http://localhost:5173
```

Try `/wiki/Jazz`, `/wiki/Mycology`, or combine interests with `/wiki/Jazz+Mathematics`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Bundle, watch and serve on :5173, with SPA fallback for `/wiki/...` routes |
| `npm run build` | Minified production bundle in `dist/` (about 19 KB gzipped JS) |
| `npm run check` | Typecheck with `tsc` |
| `npm run try -- "Jazz"` | Build one shard in Node and print the neighborhood, for tuning the scoring by eye |

## What you get

- **Neighborhood map.** An SVG ring map: the seed in the center, closest articles on the inner ring, further ones outside. Clusters get angular sectors and colors. Layout is deterministic with no force simulation, so nothing jitters. Nodes are keyboard-focusable.
- **Radius control.** *Stay close* (25 articles), *Wander further* (45) or *Everything* (60). Changing it needs no new fetch.
- **Variety rule.** No kind of article (person, work, place, organization, concept, event, thing) takes more than 40% of what is shown, which avoids the "every result is a village" problem. Kind chips hide a kind without reshuffling the map.
- **Front page.** Welcome banner, today's featured article (rotates daily), Did you know, Trending (live Pageviews API), Through the years, portal-style neighborhood lists, and every article grouped by distance.
- **Up to three seeds.** Each seed keeps its own color. Articles score by the geometric mean across seeds, and "Where your interests meet" lists bridge articles. If none exist, it asks Wikipedia for pages linking to both.
- **Local article pages.** Articles open inside the app using Wikipedia's own HTML. Links to neighborhood articles stay local; everything else goes to Wikipedia. Attribution (CC BY-SA 4.0) appears on every article page.
- **Build around any node.** Select a node and choose *Build a wiki around this*. The previous wiki stays in history, so the back button returns to it.
- **Shareable routes.** `/wiki/Jazz`, `/wiki/Jazz+Mathematics`, `?r=2` for radius, `?a=Bebop` for an article.

## How the neighborhood is chosen

`src/live.ts` runs, in the browser, a live approximation of the offline pipeline:

1. **Prose links.** Read the seed's rendered article and keep links in the prose only, ignoring navboxes and sidebars (`src/prose.ts`). Position and repeat mentions give each link a prominence score. Without this step, navbox templates make every discipline in a field look equally close.
2. **Candidates.** Prose links plus `morelike:` search results. Mutual links (the target links back) score higher. Titles shaped like years, centuries, dates and `List of …` are dropped.
3. **Co-citation.** Fetch the outgoing links of the 60 strongest candidates and count how many of them link to each other candidate, down-weighted by out-degree.
4. **Hub penalty.** For the top candidates, look up in-degree with `linksto:` and divide the score by a power of it. Very high in-degree pages take a further penalty.
5. **Rings and edges.** Ring 1 is the best 18 directly linked articles, ring 2 the best 24 that touch ring 1, ring 3 the rest. Edges come from the outgoing links among the chosen 60.
6. **Clusters.** Louvain-style modularity moves on the induced graph, with small clusters merged and the count capped at 8. Each is named after its top-scoring member.
7. **Enrich.** Descriptions, thumbnails, a rough kind from the description, featured-article candidates, and first-sentence "Did you know" hooks from quiet ring 2 and 3 articles.

The result matches the spec's shard format (`src/types.ts`), so the Rust pipeline can later replace this stage without changing the client.

## Project layout

```
src/
  main.ts          routing, rendering, search, events
  live.ts          live neighborhood scoring (stands in for the Rust pipeline)
  prose.ts         prose-link extraction from rendered article HTML
  combine.ts       merge 1-3 shards: geometric-mean scores, bridges
  neighborhood.ts  radius presets, variety rule, daily featured pick
  map.ts           deterministic ring layout and SVG rendering
  article.ts       Wikipedia HTML with link rewriting
  trending.ts      live Pageviews API, cached for an hour
  api.ts           Action API client: retries, backoff, concurrency gate
  kind.ts          kind guessed from short descriptions
scripts/try.mjs    build one shard in Node and print it
build.mjs          esbuild bundle and dev server
```

## Known limits of the prototype

- **Speed.** A first build runs around 100 to 200 API requests and takes roughly 15 to 40 seconds (about 17 s for Jazz on a typical connection). Wikipedia rate-limits bursts, so requests go through a four-wide gate. Finished shards are cached in `localStorage` for 24 hours, so repeat visits are instant.
- **Trending** can hit Pageviews API rate limits under load and then hides itself.
- **Kinds** are guessed from short descriptions, not Wikidata `P31`, so some are wrong.
- **Through the years** reads years from descriptions and is often sparse. **On this day** isn't built because it needs Wikidata dates.
- **No service worker or idle prefetch** yet.
- **Scores are approximate.** The live approach has no clickstream weights and no personalized PageRank, so quality varies by topic. Navbox-style links still leak through for some seeds.

## Roadmap

The spec's milestones, in order:

1. **Live prototype** (this repo today).
2. **Graph core.** Rust ingest of the `page`, `redirect`, `pagelinks` and `linktarget` dumps into CSR, with a CLI that prints the top 60 neighbors for any title.
3. **Shards.** Clickstream weights, rings, clustering and enrichment, written as brotli shards for a 10,000-seed sample.
4. **Full build.** Every seed over the view threshold, CDN upload, service worker, prefetch.
5. **Front page polish.** Real Did you know hooks, On this day, local article pages at scale.
6. **Multi-seed and languages.**

After the MVP: a persistent "living wiki" where seeds become districts, plus the stroll, edge sentences, vacant lots, and comparing wikis with a friend. See the spec for details.

## Data and licensing

All content comes from Wikipedia, Wikidata and Wikimedia statistics through public APIs. Article text and images are available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and credited in the app. Small Wikipedia is not affiliated with the Wikimedia Foundation.
