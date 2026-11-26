// The live proxy of `serve --live` (R10.18): one loopback server for each side with an origin.
// It writes no file. Its responses are not evidence (R10.18 item 10).
import http from 'node:http';
import https from 'node:https';
import {
  HTML_LIMIT, LIVE_SCRIPT_PATH, REQUEST_TIMEOUT_MS, STREAM_LIMIT,
  forwardHeaders, injectScript, isHtml, liveScript, plainBody, proxyRefusal, responseHeaders,
} from './live-rules.js';

const OWN_CSP = "default-src 'none'; frame-ancestors 'none'";

function plain(res, code, text = '') {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': OWN_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(text);
}

function handler({ side, sideOrigin, viewerOrigin, state }) {
  const script = Buffer.from(liveScript(viewerOrigin));
  const client = sideOrigin.startsWith('https:') ? https : http;
  return (req, res) => {
    const refusal = proxyRefusal(req, { port: state.port, sideOrigin });
    if (refusal) { if (refusal === 405) res.setHeader('Allow', 'GET, HEAD'); plain(res, refusal); return; }
    if (req.url.split('?')[0] === LIVE_SCRIPT_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': script.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin' });
      res.end(req.method === 'HEAD' ? undefined : script);
      return;
    }
    const target = new URL(req.url, sideOrigin);
    const upstream = client.request(target, {
      method: req.method,
      headers: forwardHeaders(req.headers, { sideOrigin, userAgent: side.userAgent }),
      // R10.18 item 7: a side without `remote: true` accepts any certificate, as its capture does (R3.9).
      rejectUnauthorized: side.remote === true,
    });
    const timer = setTimeout(() => { upstream.destroy(); plain(res, 504, 'TIMEOUT'); }, REQUEST_TIMEOUT_MS);
    const done = () => clearTimeout(timer);
    res.on('close', () => { done(); upstream.destroy(); });
    upstream.on('error', (error) => { done(); plain(res, 502, String(error.code ?? 'UPSTREAM_ERROR')); });
    upstream.on('response', (incoming) => {
      const html = req.method === 'GET' && isHtml(incoming.headers) && plainBody(incoming.headers);
      const clearStorage = html && !state.cleared;
      const headers = responseHeaders(incoming.headers, { sideOrigin, proxyOrigin: state.origin, viewerOrigin, requestUrl: req.url, html, clearStorage });
      if (!html) {
        res.writeHead(incoming.statusCode, headers);
        let bytes = 0;
        incoming.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > STREAM_LIMIT) { done(); incoming.destroy(); res.destroy(); return; }
          if (!res.write(chunk)) { incoming.pause(); res.once('drain', () => incoming.resume()); }
        });
        incoming.on('end', () => { done(); res.end(); });
        incoming.on('error', () => { done(); res.destroy(); });
        return;
      }
      const chunks = [];
      let bytes = 0;
      incoming.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > HTML_LIMIT) { done(); incoming.destroy(); plain(res, 502, 'HTML_TOO_LARGE'); return; }
        chunks.push(chunk);
      });
      incoming.on('error', (error) => { done(); plain(res, 502, String(error.code ?? 'UPSTREAM_ERROR')); });
      incoming.on('end', () => {
        done();
        if (res.headersSent || res.destroyed) return;
        const body = injectScript(Buffer.concat(chunks));
        if (clearStorage) state.cleared = true;
        res.writeHead(incoming.statusCode, { ...headers, 'content-length': body.length });
        res.end(body);
      });
    });
    upstream.end();
  };
}

// Starts one proxy for each side with an origin. Returns `{ origins, close }`.
export async function startLiveProxies(config, { viewerOrigin }) {
  const servers = [];
  const origins = {};
  try {
    for (const [id, side] of Object.entries(config.sides)) {
      if (side.kind === 'design' || typeof side.origin !== 'string') continue;
      const state = { port: 0, origin: '', cleared: false };
      const server = http.createServer(handler({ side, sideOrigin: side.origin, viewerOrigin, state }));
      await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
      state.port = server.address().port;
      state.origin = `http://127.0.0.1:${state.port}`;
      origins[id] = state.origin;
      servers.push(server);
    }
  } catch (error) {
    for (const server of servers) server.close();
    throw error;
  }
  const close = () => Promise.all(servers.map(server => new Promise((accept) => { server.closeAllConnections?.(); server.close(() => accept()); })));
  return { origins, close };
}
