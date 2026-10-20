import { createServer } from 'node:http';
import { open, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { serve } from '../server/serve.js';
import { validId } from './valid-id.js';

export { validId };
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
async function evidencePath(base, id, filename) {
  if (!validId(id)) throw new Error('Invalid evidence ID.');
  const root = await realpath(base);
  const path = await realpath(resolve(root, id, filename));
  const suffix = relative(root, path);
  if (suffix.startsWith('..') || isAbsolute(suffix)) throw new Error('Evidence must stay in its local directory.');
  return path;
}
export async function historyEvidencePath(local, kind, id, filename) {
  const root = await realpath(local);
  const path = await evidencePath(resolve(root, kind), id, filename);
  const suffix = relative(root, path);
  if (suffix === '..' || suffix.startsWith('../') || isAbsolute(suffix)) throw new Error('Evidence escapes the local store.');
  return path;
}
export async function loadHistoryEvidence(local, kind, id, filename) {
  const path = await historyEvidencePath(local, kind, id, filename);
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Evidence metadata is too large.');
    const buffer = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > info.size) throw new Error('Evidence changes during reading.');
    const value = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid evidence metadata.');
    return value;
  } finally { await handle.close(); }
}
export async function scanHistory(local) {
  const scan = async (kind, filename) => {
    let names; try { names = await readdir(resolve(local, kind)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return (await Promise.all(names.filter(validId).map(async id => {
      try { return { id, value: await loadHistoryEvidence(local, kind, id, filename) }; }
      catch { return { id, error: 'Unreadable metadata' }; }
    }))).sort((a, b) => b.id.localeCompare(a.id));
  };
  return { runs: await scan('runs', 'run.json'), reports: await scan('reports', 'report.json') };
}
export function renderHistory({ runs, reports }, { runUrl = id => `/run/${encodeURIComponent(id)}`, reportUrl = id => `/report/${encodeURIComponent(id)}`, staticExport = false } = {}) {
  const text = escapeHtml;
  const rows = runs.map(({ id, value: run, error }) => `<tr><td data-label="Time">${text(run?.at)}</td><td data-label="Label">${text(run?.label)}</td><td data-label="State">${text(run?.state || error)}</td><td data-label="ID">${run ? `<a href="${text(runUrl(id))}">${text(id)}</a>` : text(id)}</td><td data-label="Targets">${text(Array.isArray(run?.settings?.targets) ? run.settings.targets.map(t => t?.id).join(', ') : '')}</td><td data-label="Artifacts">${text(Array.isArray(run?.settings?.artifacts) ? run.settings.artifacts.join(', ') : '')}</td></tr>`).join('');
  const links = reports.map(({ id, value: report, error }) => `<li>${report ? `<a href="${text(reportUrl(id))}">${text(report.meta?.title || id)}</a> · ${text(report.meta?.generated)} · ${text(report.findings?.length ?? 0)} findings · ${text(id)}` : `${text(id)} · ${text(error)}`}</li>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Test kit history</title><style>body{font:16px system-ui;margin:2rem;color:#222}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.7rem;border-bottom:1px solid #ddd}td{overflow-wrap:anywhere}a{color:#a33322}li{margin:1rem 0;overflow-wrap:anywhere}body{max-width:1200px;margin:2rem auto;padding:0 24px;background:#f7f7f8}table{background:white}h1{letter-spacing:-.04em}@media(max-width:800px){thead{display:none}table,tbody{display:block}tr{display:block;border:1px solid #ddd;border-radius:12px;margin:16px 0;padding:12px}td{display:grid;grid-template-columns:80px minmax(0,1fr);gap:12px;border:0;padding:5px;font-size:14px}td:before{content:attr(data-label);color:#666}body{padding:0 16px}}</style><h1>Local test history</h1><p>${staticExport ? 'This is a static snapshot. New runs are not added to this export.' : 'Reload this page to include new runs. Evidence stays on disk.'} No automatic deletion is active.</p><h2>Runs (${runs.length})</h2><table><thead><tr><th>Time</th><th>Label</th><th>State</th><th>ID</th><th>Targets</th><th>Artifacts</th></tr></thead><tbody>${rows}</tbody></table><h2>Comparison reports (${reports.length})</h2><ul>${links}</ul></html>`;
}
export function renderRunFeedback({ id, run, feedback }, { historyUrl = '/' } = {}) {
  const text = escapeHtml;
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const findings = Array.isArray(feedback?.findings) ? feedback.findings.slice(0, 20) : [];
  const counts = (value, keys) => keys.map(key => `${text(key)}: ${number(value?.[key])}`).join(' · ');
  const details = feedback ? `<h2>Stored check feedback</h2><p>State: ${text(feedback.state)}. This is a single run. It has no A/B verdict.</p><p>Content: ${counts(feedback.content, ['checksExecuted', 'findings', 'unknown', 'missing'])}</p><p>Behavior: ${counts(feedback.behavior, ['passed', 'failed', 'skipped', 'incompatible', 'missing'])}</p><p>Findings: ${number(feedback.findingCount)}. Omitted: ${Math.max(number(feedback.omittedCount), number(feedback.findingCount) - findings.length)}.</p><ul>${findings.map(finding => `<li>${text(finding?.targetId)} · ${text(finding?.viewportId)} · ${text(finding?.artifact)} · ${text(finding?.checkId || finding?.contractId)} · ${text(finding?.state || finding?.severity)}: ${text(String(finding?.message ?? '').slice(0, 500))}</li>`).join('')}</ul>` : '<p>No standalone check feedback stored.</p>';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Run feedback</title><style>body{font:16px system-ui;max-width:1000px;margin:2rem auto;padding:0 24px;color:#222;background:#f7f7f8;overflow-wrap:anywhere}li{margin:1rem 0}a{color:#a33322}</style><a href="${text(historyUrl)}">Local history</a><h1>${text(id)}</h1><p>Label: ${text(run?.label)} · Time: ${text(run?.at)} · Capture state: ${text(run?.state)}</p>${details}</html>`;
}
export async function startHistory({ root = process.cwd(), local = resolve(root, '.test-kit'), port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid server port.');
  const viewers = new Map();
  let closing = false;
  async function viewer(id) {
    if (closing) throw new Error('History server is closing.');
    if (viewers.has(id)) return viewers.get(id);
    const pending = (async () => {
      const path = await historyEvidencePath(local, 'reports', id, 'report.json');
      const instance = await serve({ reportPath: path });
      if (closing) { await instance.close(); throw new Error('History server is closing.'); }
      return instance;
    })();
    viewers.set(id, pending);
    try { return await pending; } catch (error) { viewers.delete(id); throw error; }
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
      const raw = request.url || '';
      if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000]/.test(raw)) { response.writeHead(400); response.end(); return; }
      const path = raw.split('?')[0];
      if (path === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(request.method === 'HEAD' ? undefined : renderHistory(await scanHistory(local))); return; }
      const runMatch = /^\/run\/([A-Za-z0-9_-]+)$/.exec(path);
      if (runMatch && validId(runMatch[1])) {
        const id = runMatch[1];
        const run = await loadHistoryEvidence(local, 'runs', id, 'run.json');
        let feedback;
        try { feedback = await loadHistoryEvidence(local, 'runs', id, 'feedback.json'); } catch {}
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(request.method === 'HEAD' ? undefined : renderRunFeedback({ id, run, feedback })); return;
      }
      const match = /^\/report\/([A-Za-z0-9_-]+)$/.exec(path);
      if (!match || !validId(match[1])) { response.writeHead(404); response.end('Not found.'); return; }
      response.writeHead(302, { Location: (await viewer(match[1])).origin + '/' }); response.end();
    } catch { response.writeHead(404); response.end('Evidence is unavailable.'); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  let closePromise;
  const close = () => {
    if (closePromise) return closePromise;
    closing = true;
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    closePromise = Promise.allSettled([
      new Promise((yes, no) => server.close(error => error ? no(error) : yes())),
      ...[...viewers.values()].map(async pending => { try { await (await pending).close(); } catch {} }),
    ]).then(() => undefined);
    return closePromise;
  };
  const stop = () => { void close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  server.once('close', () => { void close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, url: origin + '/', close };
}
