import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isLocalUrl } from '../capture/helpers.js';

export function isLoopbackAddress(address) {
  return address === '::1' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address)
    || /^::ffff:127\.(?:\d{1,3}\.){2}\d{1,3}$/i.test(address);
}

export async function resolveLocalAddress(url, resolver = lookup) {
  if (!isLocalUrl(url.href) || url.protocol !== 'http:') throw new Error('Performance accepts loopback HTTP URLs only.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await resolver(host, { all: true });
  if (!addresses.length || addresses.some(entry => !isLoopbackAddress(entry.address))) throw new Error('Performance DNS must resolve only to loopback.');
  return addresses[0].address;
}

export async function startLocalProxy() {
  const blocked = [];
  let closed = false;
  const connections = new Set();
  const requests = new Set();
  function deny(request, response, reason) {
    blocked.push({ reason, url: request.url, method: request.method });
    response.writeHead(403, { 'content-type': 'text/plain', 'x-test-kit-proxy-blocked': '1' }); response.end('Local-only performance request blocked.');
  }
  const server = http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return deny(request, response, 'method');
      const url = new URL(request.url);
      const address = await resolveLocalAddress(url);
      if (closed || response.destroyed) return;
      const headers = { ...request.headers, host: url.host };
      delete headers['proxy-authorization']; delete headers['proxy-connection']; delete headers.upgrade;
      const upstream = http.request({ hostname: address, port: url.port || 80, path: `${url.pathname}${url.search}`,
        method: request.method, headers, timeout: 30000 }, incoming => {
        const location = incoming.headers.location;
        if (location && incoming.statusCode >= 300 && incoming.statusCode < 400) {
          try {
            const next = new URL(location, url);
            if (!isLocalUrl(next.href) || next.protocol !== 'http:') { incoming.destroy(); deny(request, response, 'redirect'); return; }
          } catch { incoming.destroy(); deny(request, response, 'redirect'); return; }
        }
        response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
      });
      requests.add(upstream); upstream.once('close', () => requests.delete(upstream));
      upstream.on('timeout', () => upstream.destroy(new Error('Local proxy timeout.')));
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      request.on('aborted', () => upstream.destroy());
      response.on('close', () => upstream.destroy());
      upstream.end();
    } catch { deny(request, response, 'url-or-dns'); }
  });
  server.on('connect', (request, socket) => { blocked.push({ reason: 'https-connect', url: request.url, method: request.method }); socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
  server.on('upgrade', (request, socket) => { blocked.push({ reason: 'websocket', url: request.url, method: request.method }); socket.destroy(); });
  server.on('connection', socket => { socket.on('error', () => socket.destroy()); connections.add(socket); socket.once('close', () => connections.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { port: server.address().port, blocked,
    close: () => new Promise(resolve => { closed = true; for (const request of requests) request.destroy(); for (const socket of connections) socket.destroy(); server.close(resolve); }) };
}
