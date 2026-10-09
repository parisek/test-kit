import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const fixtureRoot = new URL('../fixtures/example-site/', import.meta.url);

function escapeText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Start an explicit local integration fixture. It needs no browser. */
export async function startExampleSite({ port = 0, host = '127.0.0.1', variant = 'baseline', assetDelayMs = 100 } = {}) {
  if (!['baseline', 'changed'].includes(variant)) throw new Error('Variant must be baseline or changed.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  if (!Number.isInteger(assetDelayMs) || assetDelayMs < 0 || assetDelayMs > 10000) throw new Error('Asset delay must be an integer from 0 to 10000.');
  const [pages, css, asset] = await Promise.all([
    readFile(new URL('pages.json', fixtureRoot), 'utf8').then(JSON.parse),
    readFile(new URL('site.css', fixtureRoot)),
    readFile(new URL('asset.svg', fixtureRoot)),
  ]);
  const timers = new Set();
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const send = (status, type, body) => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(body);
    };
    if (pathname === '/redirect') {
      response.writeHead(302, { Location: '/unchanged', 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (pathname === '/site.css') return send(200, 'text/css', css);
    if (pathname === '/asset.svg') {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!response.destroyed) send(200, 'image/svg+xml', asset);
      }, assetDelayMs);
      timers.add(timer);
      response.on('close', () => { clearTimeout(timer); timers.delete(timer); });
      return;
    }
    const page = Object.hasOwn(pages, pathname) ? pages[pathname] : null;
    if (!page) return send(404, 'text/plain; charset=utf-8', 'Example site: path not found.\n');
    const changed = pathname === '/changed' && variant === 'changed';
    const text = changed ? page.changedText : page.text;
    send(page.status ?? 200, 'text/html; charset=utf-8', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeText(page.title)}</title><link rel="stylesheet" href="/site.css"></head>
<body class="${changed ? 'changed' : 'baseline'}"><main><h1>${escapeText(page.title)}</h1><div class="card">${escapeText(text)}</div>${page.asset ? '<img src="/asset.svg" alt="Blue rectangle with a white circle">' : ''}${page.motion ? '<div class="motion" aria-label="Animated square"></div>' : ''}</main></body></html>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    origin: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const flag = process.argv[index];
    const value = process.argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}.`);
    if (flag === '--port') options.port = Number(value);
    else if (flag === '--variant') options.variant = value;
    else if (flag === '--asset-delay-ms') options.assetDelayMs = Number(value);
    else throw new Error(`Unknown option: ${flag}.`);
  }
  const site = await startExampleSite(options);
  console.log(site.origin);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await site.close(); process.exit(0); });
}
