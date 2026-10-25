# Small Wikipedia (milestone 1: live prototype)

Browser-only client from the spec: no server, no LLM. It builds each "shard" live from the Wikipedia Action API.

    npm install
    npm run dev      # http://localhost:5173 (SPA fallback for /wiki/Jazz+Mathematics)
    npm run build    # minified bundle in dist/ (~19 KB gzipped JS)
    npm run check    # typecheck
    npm run try -- Jazz   # build one shard in Node and print the neighborhood

Not yet built (later milestones): Rust pipeline, clickstream weights, On this day (needs Wikidata dates),
service worker and idle prefetch, Wikidata-based kinds (kinds are guessed from descriptions here).
Live scoring is in `src/live.ts`; its output matches the spec's shard format so the pipeline can replace it.
