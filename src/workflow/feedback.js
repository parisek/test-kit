import { realpath, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readSidecar } from '../artifacts/compare.js';
import { validateContentSnapshot } from '../content/snapshot.js';
import { storedResponses } from '../content/responses.js';
import { runContentChecks } from '../checks/index.js';
import { validateBehaviorSnapshot } from '../behavior/snapshot.js';

// A single run has check feedback. It does not have an A/B verdict.
export async function summarizeRunFeedback(run, runsRoot, { maxFindings = 20, persist = true } = {}) {
  if (!Number.isInteger(maxFindings) || maxFindings < 1 || maxFindings > 20) throw new Error('Feedback limit must be 1..20.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(run.id)) throw new Error('Invalid feedback run ID.');
  const root = await realpath(runsRoot);
  const runDir = await realpath(join(root, run.id));
  const offset = relative(root, runDir);
  if (!offset || offset.startsWith('..') || offset.startsWith('/')) throw new Error('Feedback run escapes its store.');
  const result = { state: run.state === 'complete' ? 'complete' : 'incomplete', content: { checksExecuted: 0, findings: 0, unknown: 0, missing: 0 }, behavior: { passed: 0, failed: 0, skipped: 0, incompatible: 0, missing: 0 }, findingCount: 0, findings: [], omittedCount: 0 };
  const add = finding => {
    result.findingCount++;
    if (result.findings.length < maxFindings) {
      const { targetId, viewportId, artifact, checkId, contractId, severity, state, message } = finding;
      result.findings.push({ targetId, viewportId, artifact, ...(checkId ? { checkId } : {}), ...(contractId ? { contractId } : {}), ...(severity ? { severity } : {}), ...(state ? { state } : {}), message: String(message).slice(0, 500) });
    }
  };
  for (const target of run.settings.targets) for (const viewport of run.settings.viewports) {
    const scope = { targetId: target.id, viewportId: viewport.id };
    const capture = run.captures.find(row => row.targetId === target.id && row.viewportId === viewport.id);
    if (run.settings.artifacts.includes('content')) {
      const index = capture?.artifacts?.content;
      if (index?.state !== 'captured' || !run.settings.checks?.length) {
        result.content.missing++; result.state = 'incomplete';
        add({ ...scope, artifact: 'content', state: 'missing', message: run.settings.checks?.length ? 'Content evidence is missing or failed.' : 'No content checks are selected.' });
      } else try {
        if (!index.path?.endsWith('.json.gz')) throw new Error('Invalid content path.');
        const bytes = await readSidecar(runDir, index.path, 2 * 1024 * 1024);
        const snapshot = validateContentSnapshot(JSON.parse(gunzipSync(bytes, { maxOutputLength: 2 * 1024 * 1024 })));
        const findings = runContentChecks(snapshot, run.settings.checks, { ...scope, expectedLanguage: run.settings.content?.expectedLanguage, responses: storedResponses(run, viewport.id) });
        result.content.checksExecuted += run.settings.checks.length;
        for (const finding of findings) {
          result.content.findings++;
          const state = finding.evidence?.state;
          if (['unknown', 'incomplete'].includes(state)) { result.content.unknown++; result.state = 'incomplete'; }
          add({ ...finding, ...(state ? { state } : {}) });
        }
      } catch {
        result.content.missing++; result.state = 'incomplete';
        add({ ...scope, artifact: 'content', state: 'missing', message: 'Content evidence is invalid, missing, or exceeds its limit.' });
      }
    }
    if (run.settings.artifacts.includes('behavior')) {
      const index = capture?.artifacts?.behavior;
      try {
        if (!index?.path) throw new Error('Missing behavior path.');
        const snapshot = validateBehaviorSnapshot(JSON.parse(await readSidecar(runDir, index.path, 2 * 1024 * 1024)));
        for (const step of snapshot.steps) {
          if (step.id.endsWith('-detect') && step.state === 'complete') continue;
          const state = step.state === 'complete' ? 'passed' : step.state;
          result.behavior[state]++;
          if (state !== 'passed') { result.state = 'incomplete'; add({ ...scope, artifact: 'behavior', contractId: step.id, state, message: step.error ?? step.reason ?? step.title }); }
        }
        if (snapshot.state !== 'complete') result.state = 'incomplete';
        if (!snapshot.steps.some(step => !step.id.endsWith('-detect') && step.state === 'complete')) {
          result.behavior.missing++; result.state = 'incomplete';
          add({ ...scope, artifact: 'behavior', state: 'missing', message: 'No behavior assertion completes.' });
        }
        if (index.state !== 'captured' && snapshot.state === 'complete') { result.behavior.missing++; result.state = 'incomplete'; add({ ...scope, artifact: 'behavior', state: 'missing', message: 'Behavior capture is incomplete despite stored steps.' }); }
      } catch {
        result.behavior.missing++; result.state = 'incomplete';
        add({ ...scope, artifact: 'behavior', state: 'missing', message: 'Behavior evidence is invalid, missing, or exceeds its limit.' });
      }
    }
  }
  result.omittedCount = result.findingCount - result.findings.length;
  if (persist) await writeFile(join(runDir, 'feedback.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return result;
}
