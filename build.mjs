// Bundles src/ into dist/. `node build.mjs --serve` also serves dist/ with SPA fallback on :5173.
import { context, build } from 'esbuild';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const serve = process.argv.includes('--serve');
const opts = {
  entryPoints: { app: 'src/main.ts', ...{} },
  bundle: true,
  minify: !serve,
  sourcemap: serve,
  target: 'es2022',
  outdir: 'dist',
  logLevel: 'info',
};
const css = { entryPoints: { app: 'src/style.css' }, bundle: true, minify: !serve, outdir: 'dist', logLevel: 'info' };

await mkdir('dist', { recursive: true });
await cp('src/index.html', 'dist/index.html');

if (!serve) {
  await Promise.all([build(opts), build(css)]);
  process.exit(0);
}

const ctxs = await Promise.all([context(opts), context(css)]);
await Promise.all(ctxs.map((c) => c.rebuild()));
ctxs.forEach((c) => c.watch());

const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.map': 'application/json' };
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const ext = extname(path);
  try {
    if (ext && types[ext]) {
      res.writeHead(200, { 'content-type': types[ext] }).end(await readFile(join('dist', path)));
    } else {
      res.writeHead(200, { 'content-type': types['.html'] }).end(await readFile('src/index.html'));
    }
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(5173, () => console.log('Small Wikipedia on http://localhost:5173'));
