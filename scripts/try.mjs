// Build a shard for a title in Node and print a summary: node scripts/try.mjs "Jazz"
import { build } from 'esbuild';
import { DOMParser } from 'linkedom';
globalThis.DOMParser = DOMParser;
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const realFetch = globalThis.fetch;
globalThis.fetch = (u, o = {}) => realFetch(u, { ...o, headers: { 'user-agent': 'SmallWikipedia/0.1 (https://github.com/nreff/small-wiki)', ...o.headers } });

const out = join(tmpdir(), 'smallwiki-live.mjs');
await build({ entryPoints: ['src/live.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { buildShard } = await import(pathToFileURL(out).href);
const title = process.argv[2] ?? 'Jazz';
const t0 = Date.now();
const shard = await buildShard(title, (m, p) => process.stderr.write(`\r${(p * 100).toFixed(0)}% ${m}   `));
console.error(`\nbuilt in ${Date.now() - t0} ms, ${JSON.stringify(shard).length} bytes`);
for (const r of [1, 2, 3]) {
  console.log(`\nring ${r}`);
  for (const n of shard.nodes.filter((n) => n.r === r)) console.log(`  ${String(n.s).padStart(4)}  [${n.k}] c${n.c} ${n.t} — ${n.d}`);
}
console.log('\nclusters', shard.clusters.map((c) => c.name).join(' | '));
console.log('featured', shard.featured.map((f) => shard.nodes[f.n].t).join(', '));
console.log('dyk', shard.dyk.map((f) => f.text).join('\n    '));
