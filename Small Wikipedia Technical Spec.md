# Small Wikipedia: Technical Spec

Oct 23, 2026 · @Nathan

## Overview

Small Wikipedia turns any interest into a self-contained mini Wikipedia: a ring map of the articles a few links away, plus a front page built only from them. All of the graph work happens ahead of time, so a request is one static file fetch and a render, with no LLM at any step.

**Goals**

- Any English Wikipedia article can be a seed. One, two or three seeds per wiki.
- Neighborhoods feel specific: no country, year or broad-field hub pages crowding out the interesting material.
- Every fact shown comes from Wikipedia, Wikidata or Wikimedia statistics, with a link to the source article.
- Instant: the neighborhood appears faster than a Wikipedia page loads.
- Cheap to run: static files on a CDN, no always-on server required.

**Non-goals for v1**

- Editing or adding articles.
- Languages other than English. The pipeline is language-agnostic, so others come later by rerunning it.
- Accounts, sync or recommendations across sessions.

**Performance targets**

| Measure | Target |
| --- | --- |
| Neighborhood visible, warm cache | under 100 ms |
| Neighborhood visible, cold (one CDN fetch) | under 400 ms on 4G |
| Full front page with images | under 1 s |
| Client JavaScript | under 40 KB gzipped |
| Per-seed data shard | under 25 KB gzipped |
| Full pipeline rebuild | under 2 hours on one 32 GB machine |

## Architecture

&#91;embedded content: architecture · offline build and per-visit path\]

The expensive graph work runs once a month in Rust and writes static files. A visit fetches one of those files from a CDN; live Wikipedia APIs only add article pages, trending data and the fallback for rare seeds.

**Where Rust fits**

| Part | Language | Why |
| --- | --- | --- |
| Build pipeline | Rust | Parsing tens of GB of dumps, a graph of hundreds of millions of edges and millions of PageRank runs. This is where speed matters, and Rust with `rayon`, memory-mapped CSR arrays and streaming gzip parsing turns hours into minutes. |
| Serving | None (static CDN) | A server can't beat a CDN edge returning a cached file. Add a small Rust `axum` service only if you later want per-request work, like arbitrary multi-seed merges on the server. |
| Browser client | TypeScript | The client's work is parsing a 10 KB file and drawing 60 nodes: about 10 ms in plain JS. A Rust/WASM frontend (Leptos, Yew) adds a 100 KB+ bundle and slower first load for no speed gain. |
| Live fallback scoring | TypeScript, WASM optional | Co-citation over a few thousand links is fast in JS. Move it to WASM only if profiling shows it matters. |

In short: write the website in TypeScript and the engine behind it in Rust. The speed comes from doing the work before anyone visits, not from the language of the page.

## Data sources

Everything comes from public Wikimedia dumps, refreshed monthly. Live APIs are used only for per-day data and as a fallback for pages newer than the last build.

| Source | What we take | Used for | Refresh |
| --- | --- | --- | --- |
| `page` SQL dump | page id, title, namespace, redirect flag | Title ↔ id map, filtering to articles | Monthly |
| `redirect` SQL dump | redirect → target | Resolving search input and links | Monthly |
| `pagelinks` + `linktarget` SQL dumps | source page → target title | The link graph (since 2024 links point at `linktarget` rows, so join the two) | Monthly |
| `page_props` SQL dump | `wikibase_item`, `wikibase-shortdesc`, `page_image_free` | Wikidata id, one-line description, lead image | Monthly |
| Clickstream (monthly TSV) | prev → curr → click count | Edge weights: which links readers actually follow | Monthly |
| CirrusSearch index dump | opening text, incoming link count, popularity score | Article intros, hub detection, featured pick | Weekly (check current availability) |
| Wikidata JSON dump (filtered) | P31 instance of, P279, dates (P569, P570, P571, P577, P580, P585) | Kind chips, timeline, On this day | Monthly |
| Pageview dumps (monthly per-article) | views per article | Popularity, featured and Did you know picks | Monthly |
| Live: Pageviews REST API | last 7–30 days for \~40 articles | "Trending in your neighborhood" | On demand, cached 1 hour |
| Live: Action API (`origin=*`) | links, descriptions, `morelike:` search | Fallback for seeds missing from the build | On demand |

Keep only namespace 0 (articles). Resolve every link through redirects before counting it, or popular targets get split across their redirect names.

## Pipeline

One Rust binary (`smallwiki-build`) turns the monthly dumps into one small file per seed article. Each stage writes a memory-mapped binary artifact, so any stage can rerun on its own.

1. **Ingest titles.** Stream-parse the `page`, `redirect` and `page_props` SQL dumps (gzip → INSERT tuples, no MySQL). Build a dense `u32` id per article, a title table and a redirect map. Drop disambiguation pages (`page_props` flag) and lists (`List of …`), keeping them out of neighborhoods.
2. **Build the graph.** Stream `pagelinks` joined to `linktarget`, resolve redirects, keep article → article only. Sort and write CSR adjacency (offsets + targets as `u32`). Build the reverse graph the same way. About 7M nodes and a few hundred million edges fit in a few GB.
3. **Weight edges.** Join clickstream counts onto edges. Weight = 1 + log(1 + clicks). Double the weight when the link is mutual. Store weights as `f16` or quantized `u8` alongside the CSR.
4. **Mark hubs.** Compute in-degree and flag hubs: in-degree above the 99.9th percentile, or a Wikidata P31 of country, sovereign state, year, decade, century, language or broad academic discipline. Hubs can still appear but are penalized.
5. **Score neighborhoods.** For every seed, run approximate personalized PageRank with the local push algorithm (Andersen–Chung–Lang). Cost depends on the tolerance, not graph size, so each seed takes milliseconds. Final score = PPR ÷ in-degree^0.5, which cancels the pull of popular pages. Run in parallel with `rayon`.
6. **Assign rings.** Take the top 60 by score and compute the BFS hop distance from the seed within the weighted graph. Ring = min(hops, 3). If ring 1 has more than 18 members, keep the 18 highest and push the rest to ring 2.
7. **Cluster.** Run Leiden or label propagation on the induced subgraph of those 60 nodes. Merge clusters smaller than 3. Name each cluster after its highest-scoring member.
8. **Enrich.** Attach the short description, lead image filename, Wikidata kind (person, work, place, concept, event, organization, object, mapped from P31) and key dates. Pick the featured article: the highest-scoring ring 1–2 node with an image and an intro over 400 characters. Store its first paragraph from the CirrusSearch opening text.
9. **Did you know.** Optional stage: parse `{{DYK talk}}` templates from talk pages to recover real hooks Wikipedia already ran. If fewer than 3 are found, fall back to the first sentence of low-popularity, high-score ring 2–3 nodes.
10. **Write shards.** One brotli-compressed JSON file per seed (format below), keyed by a hash of the normalized title.

Seed coverage: precompute every article with at least \~100 views a month. That covers the vast majority of searches. Rarer seeds use the live fallback in the Client section.

**Shard format (v1)**

```json
{
  "v": 1,
  "seed": {"t": "Jazz", "d": "Music genre", "img": "Louis_Armstrong.jpg", "q": "Q8341"},
  "nodes": [
    {"t": "Blue Note Records", "d": "American jazz record label", "k": "org", "r": 1, "s": 312, "c": 2, "img": null, "y": 1939}
  ],
  "edges": [[0, 3, 7], [3, 12, 2]],
  "clusters": [{"name": "Record labels", "lead": 3}],
  "featured": {"n": 5, "text": "First paragraph of the article…"},
  "dyk": [{"n": 21, "text": "... that …?"}],
  "dates": [[5, "born", "1901-08-04"]]
}
```

Node index 0 is the seed. Scores are quantized to integers 0–1000. Edges are `[from, to, weight 0–9]`. A typical shard is 6–15 KB before compression.

## Neighborhood rules

Shards store 60 candidates. The client trims them, so radius changes are instant and need no new fetch.

**Radius control**

| Setting | Rings shown | Articles shown |
| --- | --- | --- |
| Stay close | 1–2 | 25 |
| Wander further | 1–3 | 45 |
| Everything | 1–3 | all 60 |

**Variety rule.** No kind takes more than 40% of the shown articles. When one does, swap its lowest-scoring members for the next-best nodes of other kinds. This fixes the "every result is a village" problem from the Local Wikipedia thread.

**Kind filter.** Chips hide a kind without refilling the slots, so the map stays stable while people toggle.

**Several seeds (up to 3)**

1. Fetch each seed's shard in parallel.
2. Combined score of a node = geometric mean of its per-seed scores. Missing from a shard counts as a small floor, not zero.
3. **Bridges** = nodes present in at least two shards, or nodes with edges into both seeds' ring 1. Show up to 6 in "Where your interests meet".
4. If no bridges exist (seeds far apart), ask the live API for `linksto:"A" linksto:"B"` and show the top results as bridges.
5. Each seed keeps its own color, and nodes take a blend toward the seed they score highest with.

**Re-centering.** "Build a wiki around this" loads that node's shard. The previous wiki stays in history, so the back button returns to it.

## Client

A static TypeScript site with no framework: one HTML file, one script, one stylesheet. It fetches a shard, lays out the rings and renders the front page from that file alone.

**Front page sections**

| Section | Source | Rule |
| --- | --- | --- |
| Welcome banner | shard | "Welcome to Jazz Wikipedia", article count |
| Neighborhood map | shard | Rings, clusters, kind chips |
| From today's featured article | shard `featured` | Rotates daily among the top 5 candidates (date as seed) |
| Did you know… | shard `dyk` | 4–5 hooks |
| Where your interests meet | combined shards | Only with 2–3 seeds |
| Trending in your neighborhood | live Pageviews API | Top 5 by 7-day views ÷ 60-day average; hidden if the call fails |
| On this day | shard `dates` | Dates matching today's month and day, else nearest upcoming |
| Through the years | shard `dates` | 6–8 dated events, chronological |
| Neighborhoods | shard `clusters` | Portal-style lists per cluster |
| Every article, by distance | shard | Grouped by ring, alphabetical |

**Map rendering.** SVG, since 60 nodes is trivial for it and it keeps nodes focusable for keyboard and screen readers. Layout is deterministic: each cluster gets an angular sector sized by its member count, and rings sit at fixed radii. No force simulation, so there is no jitter and it costs about 1 ms. Tapping a node highlights its edges and opens a summary bar.

**Article pages stay local.** Opening an article shows Wikipedia's own HTML from the Action API (`action=parse`) or REST `page/html`. Before rendering, rewrite links: neighborhood articles open inside Small Wikipedia, everything else goes to Wikipedia. This is what makes it feel like a local wiki rather than a link list.

**Search.** Autocomplete uses Wikipedia's `opensearch` with `origin=*` and `redirects=resolve`, so it always returns canonical titles. The chosen title is normalized, hashed with SubtleCrypto SHA-1 and fetched as `/s/ab/cd/<hash>.json.br`. A typed URL that misses (often a redirect) gets one `action=query&redirects=1` call, then a retry. If there is still no shard, the live fallback builds one.

**Live fallback.** For seeds missing from the build, run the API version in the browser: seed links, `linksto:` backlinks for mutual links, `morelike:` for similar pages, and co-citation over ring 1 (batches of 50 titles). It is slower, about 1–2 s, and shows a small notice.

**Routing.** `/wiki/Jazz`, `/wiki/Jazz+Mathematics`, and `?r=2` for radius. Real paths, so links are shareable and the back button works.

**Caching.** A service worker caches the app shell and every shard it fetches. Immutable shard URLs include the build date, so CDN caching can be set to a year. During idle time, prefetch the shards of the five highest-scoring ring 1 nodes so re-centering is instant.

**Images.** The pipeline stores the full Commons thumbnail path (it includes an MD5 prefix of the filename), so the client never computes it. Lazy-load with `loading="lazy"` and fixed dimensions to avoid layout shift.

## Performance budget

A cold visit costs one HTML request, one script, one stylesheet and one shard, all from the same CDN. Everything else is lazy.

| Step | Budget | How |
| --- | --- | --- |
| HTML + CSS + JS | under 50 KB brotli total | No framework; critical CSS inlined |
| Shard fetch | under 25 KB, one request | Brotli, immutable, CDN edge cache |
| Parse + layout + render map | under 10 ms | JSON.parse on small file, fixed-radius layout, one SVG string |
| Front page text | same frame as map | Everything comes from the shard |
| Images | after first paint | Lazy, fixed sizes, Commons thumbnails at 240 px |
| Trending section | after first paint | One batch of live Pageviews calls, cached 1 hour |
| Re-center on a ring 1 node | under 50 ms | Shard prefetched in idle time |

**Techniques**

- Preload the shard in the HTML when the route is known: `<link rel="preload" as="fetch">` for `/wiki/Jazz`.
- Server-render nothing; static HTML plus a shard keeps every CDN hit cacheable.
- Build the SVG as one string and assign it once, not node by node.
- Keep requests on one origin (HTTP/2 or 3) except images and the live APIs.
- Measure with Lighthouse on a mid-range Android profile, and track p75 time to neighborhood visible with a tiny `PerformanceObserver` beacon.

## Milestones

Start with the live-API client so the product can be judged before the pipeline exists. Each milestone ships something usable.

1. **Live prototype.** Browser-only client on the Action API: seed links, `linksto:`, `morelike:`, co-citation scoring, ring map, basic front page. Proves the experience; about 1–2 s per wiki.
2. **Graph core.** Rust ingest of `page`, `redirect`, `pagelinks` and `linktarget` into CSR. Command-line tool prints the top 60 neighbors for any title. Tune the hub penalty here by eye on 30 test topics.
3. **Shards.** Add clickstream weights, rings, clustering and enrichment. Write shards for a 10,000-seed sample and point the client at them.
4. **Full build.** All seeds over the view threshold, CDN upload, service worker, prefetch.
5. **Front page polish.** Real Did you know hooks, On this day, Trending, local article pages with rewritten links.
6. **Multi-seed and languages.** Bridges, then a second language edition by rerunning the pipeline.

## Phase 2: Living wiki (after MVP)

Not part of the MVP. Once single and multi-seed wikis work (milestone 6), let one person's wiki grow over time: each new seed adds a district, and reading and notes shape the graph. Unlike an [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), where an LLM compiles your own sources, the structure here comes from Wikipedia's link graph, so it stays fast, cheap and grounded. An LLM is optional.

**Experience**

- **Seeds become districts.** Adding a seed merges its shard into the personal graph. Overlaps create bridges automatically, and the front page announces them ("Adding Bauhaus connected Typography and Architecture").
- **Reading shapes the map.** Opened articles and followed links strengthen those edges and clear the fog on the map.
- **Suggested seeds.** Nodes that score highly in two or more districts but aren't seeds yet are offered as "You keep running into…".
- **Your layer.** Highlights and notes on any article, plus your own pages that link into the graph like real articles.
- **Your wiki has news.** After each monthly rebuild, show new articles, new links and trending pages inside your districts.
- **Optional LLM synthesis.** Pages written from your notes plus the Wikipedia text already in your graph, with every claim linked to its source article.

**Data model (local-first, IndexedDB)**

| Store | Key | Holds |
| --- | --- | --- |
| `seeds` | title | added date, district color, pinned flag |
| `shards` | title + build date | cached shard JSON for each seed |
| `graph` | derived | merged nodes and edges with per-district scores; rebuilt from `shards` on change, never edited directly |
| `reads` | title | first and last read, read count, seconds on page |
| `trails` | from + to | times you followed that link; adds weight to the edge |
| `notes` | id | article title or own page, text, highlights, created and updated dates |
| `pages` | slug | your own pages; links to titles become edges |

The merged score of a node = sum of its per-district scores + a reading bonus from `reads` and `trails`. The graph is always derived, so a pipeline rebuild only replaces cached shards.

**Export.** One click writes an Obsidian-style folder: a markdown page per article in the graph (title, description, link to Wikipedia, your notes), a page per district, and wikilinks for every edge. That folder can also serve as the source folder for an LLM Wiki.

**Build order**

1. Persistent seeds and the merged graph, with districts on the map.
2. Reading history and trail weighting.
3. Suggested seeds.
4. Notes, highlights and own pages.
5. Export.
6. Monthly "what's new" front page.
7. Optional LLM synthesis pages.

**Open questions**

- Does the map stay readable past about 8 districts and 400 nodes, or does it need zoomable district views?
- Should districts you stop visiting fade over time?
- Sync across devices: an account, or export and import only?

## Future milestones

These come after the MVP. The first three work with any wiki and can ship in any order; comparing with a friend needs the Phase 2 living wiki.

| Feature | Needs | Work | Depends on |
| --- | --- | --- | --- |
| The stroll | Edge weights already in shards | Client only | MVP |
| Edge sentences | Article wikitext dump | Pipeline stage + small lazy file | MVP |
| Vacant lots | `pagelinks` + `linktarget` already ingested | Pipeline stage + shard field | MVP |
| Compare with a friend | Two personal wikis | Client only, no server | Phase 2 |

**The stroll.** A "Take a stroll" button walks the neighborhood one article at a time, like wandering instead of reading a directory. Each step picks the next article with probability proportional to the clickstream weight of the links readers actually follow. It never revisits an article and leaves the neighborhood only rarely. Each stop shows the article's summary card, the sentence that led there (once edge sentences exist), and "Keep walking" or "Read this". The walk is saved, so it can be retraced or shared.

**Edge sentences.** Tapping an edge on the map shows the actual sentence where one article links to the other, so every line on the map becomes a small fact. A new pipeline stage parses the pages-articles wikitext dump, finds each `[[link]]` in prose (skipping infoboxes and navboxes), and keeps its sentence, trimmed to about 200 characters. Mutual links keep both sentences. They go in a separate per-seed file (`/e/<hash>.json.br`) loaded on first tap, so the main shard stays small.

**Vacant lots.** A front page section listing articles Wikipedia doesn't have yet but your neighborhood keeps linking to: red links. The pipeline finds `linktarget` titles with no matching article and counts how many neighborhood articles link to each. Show the top 5 linked from at least 3 articles, with the count and a "Start this article on Wikipedia" link. It turns the site into a to-do list for editors who love the topic.

**Compare with a friend.** Two people overlay their living wikis and see where their worlds meet.

- **Sharing without a server.** A share link carries only your seed list (and optionally your most-read articles) in the URL. Notes and full reading history never leave the device unless you choose to include them.
- **Your border.** The friend's shards load and merge with yours: shared articles, districts that touch, and bridge articles connecting a district of yours to one of theirs.
- **Read this to understand them.** Their highest-scoring articles that sit closest to your graph, so each person gets a short reading list into the other's world.
- **Map view.** Both people's districts on one map in two colors, with the shared area in a third.

Open question: should comparisons be saved as a joint wiki that both people can keep adding to?

## Testing

- **Golden topics.** 30 seeds across fields (Jazz, Mycology, Byzantine Empire, Typography, a small village, a living person). Snapshot their top 25 and review diffs on every scoring change.
- **Hub leakage check.** Fail the build if more than 2% of shards contain a flagged hub in ring 1.
- **Variety check.** Report shards where one kind exceeds 40% before the client-side rule applies.
- **Size check.** Fail if any shard exceeds 40 KB compressed.
- **Client budget.** Lighthouse CI on three routes; fail on regressions past the budget table.

## Open questions

- Hosting for millions of small files: per-seed objects on R2/S3, or a few large packs read with HTTP Range requests and a static hash index?
- Precompute threshold: 100 monthly views, or a fixed top-N articles?
- Should Did you know prefer real Wikipedia hooks even when they come from weaker neighbors?
- How often is a monthly rebuild worth it versus quarterly?
- Licensing: show CC BY-SA attribution on every article page and the footer.
