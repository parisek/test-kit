import { storedResponses } from '../content/responses.js';
import { gunzipSync } from 'node:zlib';
import { validateContentSnapshot } from '../content/snapshot.js';
import { comparatorDescriptor } from './comparator.js';
import { normalizeConfig } from '../config/normalize.js';
import { createHash } from 'node:crypto';
import { settingsHash } from '../config/settings.js';
import { readSidecar } from '../artifacts/compare.js';
export const byteHash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
export const pairKey = (a, b) => settingsHash([a, b]);
export const policyHash = rules => settingsHash(Object.entries(rules));
export function comparatorIndex(artifact, rules = {}, contentPolicy = {}) {
  const descriptor = comparatorDescriptor(artifact, rules, contentPolicy);
  return { tool: descriptor.name, version: descriptor.version, settingsHash: artifact === 'screenshot'
    ? byteHash(Buffer.from(JSON.stringify(descriptor.settings))) : settingsHash(descriptor.settings) };
}
export async function evidenceBinding({ runsRoot, aRunId, bRunId, targetId, viewportId, artifact, rules, runs, contentPolicy }) {
  if (!['screenshot', 'html', 'content'].includes(artifact)) throw new Error('Evidence artifact is not comparable.');
  const values = [];
  const contentPolicies = [];
  for (const [position, id] of [aRunId, bRunId].entries()) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,200}$/.test(id)) throw new Error('Unsafe evidence run ID.');
    const run = runs?.[position] ?? JSON.parse(await readSidecar(runsRoot, id + '/run.json', 16_000_000));
    if (run.id !== id || run.schemaVersion !== 2 || !Array.isArray(run.captures) || !Array.isArray(run.settings?.viewports)
      || !Array.isArray(run.tools) || !run.settings.sides?.[run.side]) throw new Error('Stored evidence manifest is invalid.');
    normalizeConfig(run.settings);
    contentPolicies.push({ checks: run.settings.checks ?? [], expectedLanguage: run.settings.content?.expectedLanguage ?? null });
    const captures = run.captures.filter(capture => capture.targetId === targetId && capture.viewportId === viewportId);
    const viewports = run.settings.viewports.filter(viewport => viewport.id === viewportId);
    if (captures.length !== 1 || viewports.length !== 1) throw new Error('Stored evidence scope is not unique.');
    const capture = captures[0], viewport = viewports[0];
    const index = artifact !== 'screenshot' ? capture.artifacts?.[artifact] : {
      state: capture.state, path: capture.path, tool: run.tools[0]?.name, version: run.tools[0]?.version, settingsHash: run.settingsHash,
    };
    if (index?.state !== 'captured' || !index.path
      || !['tool', 'version', 'settingsHash'].every(key => typeof index[key] === 'string' && index[key].length > 0 && index[key].length <= 200)
      || !Number.isInteger(viewport.width) || viewport.width < 1 || viewport.width > 4096
      || !Number.isInteger(viewport.height) || viewport.height < 1 || viewport.height > 4096
      || !Number.isFinite(viewport.deviceScaleFactor ?? 1) || (viewport.deviceScaleFactor ?? 1) < 0.5 || (viewport.deviceScaleFactor ?? 1) > 3) throw new Error('Stored evidence is incomplete or malformed.');
    const bytes = await readSidecar(runsRoot, id + '/' + index.path, artifact !== 'screenshot' ? 2 * 1024 * 1024 : 80_000_000);
    if (artifact === 'content') validateContentSnapshot(JSON.parse(gunzipSync(bytes, { maxOutputLength: 2 * 1024 * 1024 })));
    const browser = run.captureSettings?.browser ?? null;
    const tools = run.tools.filter(tool => !tool.artifact || tool.artifact === artifact).map(({ name, version, settingsHash }) => ({ name, version, settingsHash }));
    values.push({ raw: byteHash(bytes), src: 'runs/' + id + '/' + (artifact === 'content' ? index.path.slice(0, -3) : index.path),
      binding: { viewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.deviceScaleFactor ?? 1 },
        browser, tools, index: { tool: index.tool, version: index.version, settingsHash: index.settingsHash, browserVersion: index.browserVersion ?? null },
        ...(artifact === 'content' ? { responses: storedResponses(run, viewportId) } : {}),
        ...(artifact === 'screenshot' ? { screenshot: run.settings.screenshot, settle: run.settings.sides[run.side].settle } : {}) } });
  }
  const selectedPolicy = contentPolicy ?? contentPolicies[1];
  const comparator = { ...comparatorDescriptor(artifact, rules, selectedPolicy), index: comparatorIndex(artifact, rules, selectedPolicy) };
  const evidence = { rawA: values[0].raw, rawB: values[1].raw,
    bindingHash: settingsHash({ sources: values.map(value => value.binding), comparator }), policyHash: policyHash(rules) };
  const scope = { aRunId, bRunId, pairKey: pairKey(aRunId, bRunId), targetId, viewportId, artifact };
  return { ...scope, fingerprint: settingsHash({ scope, evidence }), evidence, sources: values.map(value => value.src) };
}
