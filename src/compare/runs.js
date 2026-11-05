import { screenshotScope, scopeMatches, settlementMatches, settleRecipe, settingsHash } from '../config/settings.js';
import { isLocalUrl } from '../capture/helpers.js';
import { comparePerformanceArtifact } from '../perf/compare-artifact.js';
import { compareBehaviorArtifact } from '../behavior/compare-artifact.js';
import { compareContentArtifact } from '../content/compare-artifact.js';
import { normalizeRules, normalizeKnown } from '../rules/model.js';
import { pairKey, policyHash, evidenceBinding, comparatorIndex } from '../rules/evidence.js';
import { compareResponseArtifact } from '../artifacts/compare.js';
import { statusDifference } from '../artifacts/schema.js';
import { readFile, mkdir, writeFile, realpath, readdir, open } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { relativePath } from '../report/safe.js';
import { SCHEMA_VERSION, validateReport } from '../report/model.js';
import { LIGHTHOUSE_CAUSE_CHECK, LIGHTHOUSE_CHECKS } from '../report/catalog.js';
import { builtinChecks } from '../checks/index.js';
import { droppedForRow } from '../report/dropped.js';
import { comparePackArtifact, PACK_ARTIFACT_KINDS } from './packs.js';
import { validateSelection, cellSelected, recordSelection } from '../capture/selection.js';
import { isDesignRun, designPairProblem } from '../design/compare.js';
import { sha256 } from '../design/png.js';

// The text of a status finding: each differing field with both values, bounded in size.
// A path is cut around the first character where A and B differ. A chain shows the steps around its first differing step.
export function statusMessage({ a, b }) {
	const common = (x, y) => { let n = 0; while (n < x.length && n < y.length && x[n] === y[n]) n++; return n; };
	const path = (value, other) => {
		const start = Math.max(0, common(value, other) - 30);
		const text = value.slice(start, start + 120);
		return (start ? '…' : '') + text + (start + 120 < value.length ? '…' : '');
	};
	const chain = (list, other) => {
		if (!list.length) return 'none';
		let first = 0; while (first < list.length && first < other.length && list[first] === other[first]) first++;
		const start = Math.max(0, Math.min(first, list.length - 1) - 1), end = Math.min(list.length, start + 4);
		return (start ? `(${start} before) ` : '') + list.slice(start, end).map((step, k) => path(step, other[start + k] ?? '')).join(' > ') + (end < list.length ? ` > (${list.length - end} more)` : '');
	};
	const parts = { statusCode: () => `status A ${a.statusCode}, B ${b.statusCode}`, finalPath: () => `final path A ${path(a.finalPath, b.finalPath)}, B ${path(b.finalPath, a.finalPath)}`,
		redirects: () => `redirects A ${chain(a.redirects, b.redirects)}, B ${chain(b.redirects, a.redirects)}` };
	const fields = statusDifference(a, b);
	return fields.length ? `HTTP response differs: ${fields.map(field => parts[field]()).join('; ')}.` : null;
}

function performanceEnvironment(run) {
  try { const origin = new URL(run.settings.sides[run.side].origin); return origin.protocol === 'http:' && isLocalUrl(origin.href) ? `${run.side}|${origin.origin}` : null; } catch { return null; }
}

async function contained(root, path) {
	if (!relativePath(path)) throw new Error('Unsafe stored artifact path.');
	const base = await realpath(root);
	const file = await realpath(resolve(base, path));
	const offset = relative(base, file);
	if (offset.startsWith('..') || offset.startsWith('/') || offset === '') throw new Error('Stored artifact escapes its run.');
	return file;
}

// Owner decision on #94: a component without a fixture is skipped and listed as "no fixture". Run data is untrusted,
// so each ID is checked and the list is bounded.
function noFixtureField(run) {
	const list = run.targetSource?.noFixture;
	const ids = Array.isArray(list) ? list.filter((id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)).slice(0, 1000) : [];
	return ids.length ? { noFixture: ids } : {};
}

async function readRun(root, id) {
	if (!relativePath(id) || id.includes('/')) throw new Error('Run must be a safe ID.');
	const path = await contained(root, `${id}/run.json`);
	const handle = await open(path, 'r');
	let bytes;
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size > 16_000_000) throw new Error('Run manifest exceeds the size limit.');
		bytes = Buffer.alloc(info.size + 1);
		let length = 0;
		while (length < bytes.length) {
			const result = await handle.read(bytes, length, bytes.length - length, null);
			if (!result.bytesRead) break;
			length += result.bytesRead;
		}
		if (length > info.size) throw new Error('Run manifest changed during reading.');
		bytes = bytes.subarray(0, length);
	} finally { await handle.close(); }
	const run = JSON.parse(bytes);
	if (run.schemaVersion !== 2 || run.id !== id || !Array.isArray(run.captures) || !Array.isArray(run.settings?.targets) || !Array.isArray(run.settings?.viewports)) throw new Error(`Invalid run ${id}.`);
	if (run.settings.targets.length > 1000 || run.settings.viewports.length > 20 || run.captures.length > 20_000 || run.tools?.length > 20) throw new Error('Run collections exceed the size limit.');
	if (typeof run.settingsHash !== 'string' || !run.settingsHash.startsWith('sha256:') || !Array.isArray(run.tools) || run.tools.length === 0) throw new Error('Run provenance is missing.');
	if (!run.settings.sides || !Object.hasOwn(run.settings.sides, run.side)) throw new Error('Stored side settings are missing.');
	for (const tool of run.tools) if (!tool || typeof tool.name !== 'string' || typeof tool.version !== 'string' || typeof tool.settingsHash !== 'string') throw new Error('Invalid run tool provenance.');
	const keys = new Set();
	for (const capture of run.captures) {
		if (!capture || typeof capture.targetId !== 'string' || typeof capture.viewportId !== 'string' || !['captured', 'failed'].includes(capture.state)) throw new Error('Invalid stored capture.');
		const key = JSON.stringify([capture.targetId, capture.viewportId]);
		if (keys.has(key)) throw new Error('Duplicate stored capture.');
		keys.add(key);
	}
	for (const rows of [run.settings.targets, run.settings.viewports]) {
		const ids = new Set();
		for (const row of rows) {
			if (!row || !relativePath(row.id) || row.id.includes('/') || ids.has(row.id)) throw new Error('Unsafe or duplicate stored capture ID.');
			ids.add(row.id);
		}
	}
	// R4.5: a recorded selection is checked. A run without one is a full run: nothing is inferred from absence.
	if (run.selection !== undefined) {
		validateSelection(run.selection, run.settings);
		if (run.captures.some(capture => !cellSelected(run.selection, capture.targetId, capture.viewportId))) throw new Error('Stored capture lies outside the stored selection.');
	}
	return run;
}

async function readPng(path) {
	const file = await open(path, 'r');
	try {
		const info = await file.stat();
		if (!info.isFile() || info.size > 80_000_000) throw new Error('PNG exceeds the file size limit.');
		const bytes = Buffer.alloc(info.size);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
			if (!bytesRead) throw new Error('PNG changed during comparison.');
			offset += bytesRead;
		}
		return bytes;
	} finally { await file.close(); }
}

function effectiveSettings(run) {
	return JSON.stringify({ viewports: run.settings?.viewports, settle: run.settings?.sides?.[run.side]?.settle, screenshot: run.settings?.screenshot });
}

function available(capture) {
	if (capture?.state === 'failed') return 'capture-error';
	return capture?.statusCode == null ? 'unknown' : capture.statusCode >= 400 ? 'http-error' : 'ok';
}

// R3.9: a pair whose sides list different origins names the key, so a person finds the cause.
export function incompatibleDiagnostic(runA, runB, a, b) {
  // R8.15: a pair with a design run names the size or viewport problem.
  if (a && b && (isDesignRun(runA) || isDesignRun(runB))) {
    const problem = designPairProblem(runA, runB, a, b);
    if (problem) return problem;
  }
  const list = run => JSON.stringify(run?.captureSettings?.allowOrigins ?? null);
  return list(runA) !== list(runB) ? 'Capture settings differ: allowOrigins is not the same on both sides.' : 'Capture settings or tool versions differ.';
}

export function comparisonState(a, b, runA, runB) {
	if (!a || !b) return 'missing';
	if (a.state !== 'captured' || b.state !== 'captured') return 'failed';
	// R8.15: a design run has no browser, so the browser settings, tools and scope do not apply. The viewport and the image width do (R8.15).
	if (isDesignRun(runA) || isDesignRun(runB)) return designPairProblem(runA, runB, a, b) ? 'incompatible' : 'complete';
	if (runA.settingsHash !== runB.settingsHash || JSON.stringify(runA.tools.filter(tool => !tool.artifact || tool.artifact === 'screenshot')) !== JSON.stringify(runB.tools.filter(tool => !tool.artifact || tool.artifact === 'screenshot'))) return 'incompatible';
	if (effectiveSettings(runA) !== effectiveSettings(runB)) return 'incompatible';
	const scope = (capture, run) => screenshotScope(run.settings?.targets?.find(target => target.id === capture.targetId), run.side);
	let scopeA, scopeB;
	try { scopeA = scope(a, runA); scopeB = scope(b, runB); } catch { return 'incompatible'; }
	if (settingsHash(scopeA) !== settingsHash(scopeB)) return 'incompatible';
	if (runA.settings?.sides && runB.settings?.sides) {
		const target = (run, capture) => run.settings.targets.find(item => item.id === capture.targetId);
		try {
			if (!settlementMatches(a, runA.settings, runA.side, target(runA, a)) || !settlementMatches(b, runB.settings, runB.side, target(runB, b))
				|| settingsHash(settleRecipe(runA.settings, runA.side, target(runA, a))) !== settingsHash(settleRecipe(runB.settings, runB.side, target(runB, b)))) return 'incompatible';
		} catch { return 'incompatible'; }
	}
	if ([ [a, scopeA], [b, scopeB] ].some(([capture, recipe]) => !scopeMatches(capture, recipe))) return 'incompatible';
	return 'complete';
}

export async function compareRuns({ runsRoot, runA: aId, runB: bId, outputDir, kind: kindInput, rules: inputRules, known_diffs: inputKnown, contentChecks, contentExpectedLanguage, failOnBudget = false, filter: filterInput }) {
	const rules = normalizeRules(inputRules), known_diffs = normalizeKnown(inputKnown);
	const key = pairKey(aId, bId);
	const a = await readRun(runsRoot, aId);
	const b = await readRun(runsRoot, bId);
	// R8.15: a pair with a design run reads as a convergence pair unless the caller names a kind.
	const kind = kindInput ?? (isDesignRun(a) || isDesignRun(b) ? 'convergence' : 'update');
	const { PNG } = await import('pngjs');
	const { default: pixelmatch } = await import('pixelmatch');
	const { extractRegions } = await import('./regions.js');
	const output = resolve(outputDir);
	await mkdir(output, { recursive: true });
	if ((await readdir(output)).length) throw new Error('Comparison output directory must be empty.');
	const diffSettingsHash = comparatorIndex('screenshot').settingsHash;
	const allViewports = [...a.settings.viewports, ...b.settings.viewports].map((item) => [item.id, item]);
	const allTargets = [...a.settings.targets, ...b.settings.targets].map((item) => [item.id, item]);
	// R4.5: a cell is skipped only when it lies outside a recorded selection of run A or run B, or outside the filter of this call.
	// A run without a selection skips nothing. The filter is checked against the ids of both runs.
	const filter = filterInput ? recordSelection({ targets: [...new Map(allTargets).values()], viewports: [...new Map(allViewports).values()] }, filterInput) : null;
	const inScope = (targetId, viewportId) => cellSelected(a.selection, targetId, viewportId) && cellSelected(b.selection, targetId, viewportId) && cellSelected(filter, targetId, viewportId);
	const viewports = new Map(allViewports.filter(([viewportId]) => allTargets.some(([targetId]) => inScope(targetId, viewportId))));
	const targets = new Map(allTargets.filter(([targetId]) => allViewports.some(([viewportId]) => inScope(targetId, viewportId))));
	if (!targets.size) throw new Error('The selections of the two runs and the filter have no cell in common.');
	const scoped = a.selection !== undefined || b.selection !== undefined || filter !== null;
	let compared = 0;
	let exitCode = 0;
	const findings = [];
	const entries = [];
	// ADR 0004, section 1: one catalog entry for each selected check (R9.8). A viewer never invents one.
	const checks = {};
	for (const target of targets.values()) {
		const rows = [];
		for (const viewport of viewports.values()) {
			if (!inScope(target.id, viewport.id)) continue;
			compared++;
			const ac = a.captures.find((item) => item.targetId === target.id && item.viewportId === viewport.id);
			const bc = b.captures.find((item) => item.targetId === target.id && item.viewportId === viewport.id);
			const row = { id: viewport.id, state: comparisonState(ac, bc, a, b), availability: { a: available(ac), b: available(bc) }, artifacts: { screenshot: { a: null, b: null, diff: null } } };
			// R3.8: a remote side aborts subresources of other origins. Carry the record to the report.
			const dropped = droppedForRow(ac, bc);
			if (dropped) row.dropped = dropped;
			const images = [];
			const requested = new Set([...(a.settings.artifacts ?? ['screenshot']), ...(b.settings.artifacts ?? ['screenshot'])]);
			if (requested.has('screenshot')) {
			const shotA = (a.settings.artifacts ?? ['screenshot']).includes('screenshot') ? ac : null;
			const shotB = (b.settings.artifacts ?? ['screenshot']).includes('screenshot') ? bc : null;
			row.state = comparisonState(shotA, shotB, a, b);
			for (const [run, capture, key] of [[a, shotA, 'a'], [b, shotB, 'b']]) {
				if (capture?.state !== 'captured') { images.push(null); continue; }
				try {
					const source = await contained(join(runsRoot, run.id), capture.path);
					const bytes = await readPng(source);
					// R8.15: a design run is immutable. The image must still have the hash recorded at import.
					if (isDesignRun(run) && sha256(bytes) !== capture.design?.sha256) throw new Error('Design image changed after import.');
					if (bytes.length < 24 || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 40_000_000) throw new Error('PNG exceeds the pixel limit.');
					const image = PNG.sync.read(bytes);
					const src = `runs/${run.id}/${capture.path}`;
					await mkdir(dirname(join(output, src)), { recursive: true });
					await writeFile(join(output, src), bytes);
					const tool = run.tools[0];
					row.artifacts.screenshot[key] = { src, kind: 'screenshot', tool: tool.name, version: tool.version, settingsHash: tool.settingsHash };
					images.push(image);
				} catch (error) {
					row.state = 'failed'; row.diagnostic = String(error.message); images.push(null);
				}
			}
			if (row.state === 'complete' && images.every(Boolean)) {
				const [ai, bi] = images;
				const width = Math.max(ai.width, bi.width), height = Math.max(ai.height, bi.height);
				if (width * height > 40_000_000) { row.state = 'failed'; row.diagnostic = 'Comparison canvas exceeds 40 million pixels.'; } else {
				const pad = (image) => {
					const result = new PNG({ width, height }); result.data.fill(255);
					PNG.bitblt(image, result, 0, 0, image.width, image.height, 0, 0); return result;
				};
				const diff = new PNG({ width, height });
				const changed = pixelmatch(pad(ai).data, pad(bi).data, diff.data, width, height, { threshold: 0.1 });
				const ratio = 100 * changed / (width * height);
				const src = `diff/${target.id}/${viewport.id}.png`;
				await mkdir(dirname(join(output, src)), { recursive: true });
				await writeFile(join(output, src), PNG.sync.write(diff));
				row.ratio = ratio;
				row.artifacts.screenshot.diff = { src, kind: 'screenshot', tool: 'pixelmatch', version: '8.0.0', settingsHash: diffSettingsHash, ratio, size: { a: { width: ai.width, height: ai.height }, b: { width: bi.width, height: bi.height } }, regions: extractRegions(diff.data, width, height, { minPixels: 1 }).map(({ x, y, w, h, pixels }) => ({ x, y, width: w, height: h, pixels, unit: 'px' })) };
				if (changed || ai.width !== bi.width || ai.height !== bi.height) findings.push({ id: `${target.id}-${viewport.id}`, targetId: target.id, viewportId: viewport.id, artifact: 'screenshot', layer: 'package', message: ai.width !== bi.width || ai.height !== bi.height ? 'Screenshot dimensions differ.' : 'Screenshot pixels differ.' });
			}
			} else row.diagnostic ??= row.state === 'incompatible' ? incompatibleDiagnostic(a, b, ac, bc) : ac?.error?.message ?? bc?.error?.message ?? 'Evidence is missing.';
			row.artifacts.screenshot.state = row.state;
			} else { delete row.artifacts.screenshot; row.state = 'complete'; }
			for (const artifact of ['html', 'status'].filter(kind => requested.has(kind))) {
				row.artifacts[artifact] = await compareResponseArtifact({ kind: artifact, a, b, ac, bc, runsRoot, output, targetId: target.id, viewportId: viewport.id, rules, context: { pairKey: key, kind, targetId: target.id } });
				if (artifact === 'html' && row.artifacts.html.state === 'complete' && (row.artifacts.html.diff?.rawChanged ?? row.artifacts.html.diff?.changed)) {
					findings.push({ id: 'html-' + target.id + '-' + viewport.id, targetId: target.id, viewportId: viewport.id, artifact: 'html', layer: 'package', message: 'HTML response bytes differ.' });
				}
				// R6.13: a difference in final status, final path or redirect chain is a finding. Asset counts are not.
				if (artifact === 'status' && row.artifacts.status.state === 'complete' && row.artifacts.status.diff?.changed) {
					const message = statusMessage(JSON.parse(await readFile(join(output, row.artifacts.status.diff.src), 'utf8')));
					if (message) findings.push({ id: 'status-' + target.id + '-' + viewport.id, targetId: target.id, viewportId: viewport.id, artifact: 'status', layer: 'package', message });
				}
			}
			if (requested.has('content')) {
				const content = await compareContentArtifact({ a, b, ac, bc, runsRoot, output, targetId: target.id, viewportId: viewport.id, contentChecks, contentExpectedLanguage });
				row.artifacts.content = content.artifact;
				for (const id of content.artifact.scope.checks) if (!Object.hasOwn(builtinChecks, id)) throw new Error('Unknown content check.'); else checks[id] ??= { basis: builtinChecks[id].basis, layer: 'package', title: builtinChecks[id].title };
				// An absolute finding names the run it is about. Only side B enters the list today (ADR 0004, "Open points", 1).
				content.findings.forEach((finding, index) => findings.push({ targetId: finding.targetId, viewportId: finding.viewportId, artifact: 'content', checkId: finding.checkId, layer: 'package', ...(builtinChecks[finding.checkId].basis === 'absolute' ? { runId: b.id } : {}), severity: finding.severity, message: finding.message, id: `content-${target.id}-${viewport.id}-${finding.checkId}-${index}` }));
			}
			if (requested.has('behavior')) {
				const behavior = await compareBehaviorArtifact({ a, b, ac, bc, runsRoot, output, targetId: target.id, viewportId: viewport.id });
				row.artifacts.behavior = behavior.artifact; findings.push(...behavior.findings); Object.assign(checks, { ...behavior.catalog, ...checks });
			}
			if (requested.has('lighthouse')) {
				const budgets = b.performance?.budgets ?? {};
				const speed = await comparePerformanceArtifact({ a, b, ac, bc, runsRoot, output, targetId: target.id, viewportId: viewport.id, environmentA: performanceEnvironment(a), environmentB: performanceEnvironment(b), budgets, failOnBudget });
				// The selection comes from the run settings: the change check always, the budget check when the run has budgets.
				const selected = ['lighthouse-change', ...(Object.keys(budgets).length ? ['lighthouse-budget'] : [])];
				row.artifacts.lighthouse = { ...speed.artifact, scope: { checks: selected } };
				for (const id of selected) checks[id] ??= { ...LIGHTHOUSE_CHECKS[id] };
				exitCode ||= speed.exitCode;
				speed.findings.forEach((finding, index) => {
					const checkId = LIGHTHOUSE_CAUSE_CHECK[finding.cause];
					checks[checkId] ??= { ...LIGHTHOUSE_CHECKS[checkId] };
					findings.push({ ...finding, checkId, layer: LIGHTHOUSE_CHECKS[checkId].layer, ...(LIGHTHOUSE_CHECKS[checkId].basis === 'absolute' ? { runId: b.id } : {}), id: `lighthouse-${target.id}-${viewport.id}-${index}` });
				});
			}
			// R13.51: a pack result that `capture --packs` stored in run B. A run with none adds nothing (R5.1).
			for (const kind of PACK_ARTIFACT_KINDS) {
				const pack = await comparePackArtifact({ kind, b, bc, runsRoot, output, targetId: target.id, viewportId: viewport.id });
				if (!pack) continue;
				row.artifacts[kind] = pack.artifact; findings.push(...pack.findings); Object.assign(checks, { ...pack.catalog, ...checks });
			}
			// R8.7: an incomplete status artifact makes the cell incomplete, like any other selected artifact (#295).
			const states = ['screenshot', 'html', 'status', 'content', 'behavior', 'lighthouse'].filter(kind => requested.has(kind)).map(kind => row.artifacts[kind]?.state ?? 'missing');
			states.push(...PACK_ARTIFACT_KINDS.filter(kind => row.artifacts[kind]).map(kind => row.artifacts[kind].state));
			if (!states.length) states.push('missing');
			row.state = ['failed', 'incompatible', 'missing'].find(state => states.includes(state)) ?? 'complete';
			if (ac?.state === 'failed' || bc?.state === 'failed') {
				row.state = 'failed';
				row.diagnostic ??= ac?.error?.message ?? bc?.error?.message ?? 'Capture fails.';
			}
			rows.push(row);
		}
		entries.push({ id: target.id, kind: target.kind, title: target.title, path: target.path ?? '/', viewports: rows, artifacts: {} });
	}
	const report = { schemaVersion: SCHEMA_VERSION, meta: { title: `${a.label} → ${b.label}`, generated: new Date().toISOString(), matchBelow: 3, primaryViewport: [...viewports.keys()][0], viewports: [...viewports.values()], noiseFloor: null, tools: [...a.tools, ...b.tools, { name: 'pixelmatch', version: '8.0.0', settingsHash: diffSettingsHash }] }, runs: [a, b].map((run) => ({ id: run.id, side: run.side, label: run.label, at: run.at, state: run.state, ...noFixtureField(run), settings: { sides: { [run.side]: run.settings.sides[run.side] }, viewports: run.settings.viewports, screenshot: run.settings.screenshot,
    targets: run.settings.targets.filter(target => target.settle !== undefined || target.settleBySide?.[run.side] !== undefined).map(target => ({ id: target.id,
      ...(target.settle !== undefined ? { settle: target.settle } : {}),
      ...(target.settleBySide?.[run.side] !== undefined ? { settleBySide: { [run.side]: target.settleBySide[run.side] } } : {}) })) }, tools: run.tools })), pair: { kind, aRunId: a.id, bRunId: b.id }, checks, entries, causes: [], findings, rules: {} };
	const responseTools = new Map();
	for (const entry of entries) for (const row of entry.viewports) for (const kind of ['html', 'status', 'content', 'behavior', 'lighthouse']) {
		const index = row.artifacts[kind]?.diff;
		if (index) responseTools.set(index.settingsHash, { name: index.tool, version: index.version, settingsHash: index.settingsHash });
		const normalized = row.artifacts[kind]?.normalizedA;
		if (normalized) responseTools.set(normalized.settingsHash, { name: normalized.tool, version: normalized.version, settingsHash: normalized.settingsHash });
	}
	report.meta.tools.push(...responseTools.values());
	report.pair.key = key;
	// R4.5: the report records its scope and the count of skipped cells. A full pair adds neither key.
	if (scoped) {
		report.meta.scope = { a: a.selection ?? null, b: b.selection ?? null, filter };
		report.meta.skipped = new Map(allTargets).size * new Map(allViewports).size - compared;
	}
	report.rules = rules;
	report.known_diffs = { [key]: known_diffs[key] ?? [] };
	report.meta.comparisonPolicyHash = policyHash(rules);
	for (const finding of findings) {
		if (!['screenshot', 'html', 'status', 'content'].includes(finding.artifact)) continue;
		// Known differences and fingerprints bind a difference between A and B. An absolute finding has no cause until the allowlist ships (#254).
		if (finding.runId !== undefined) continue;
		const entry = entries.find(entry => entry.id === finding.targetId);
		const row = entry.viewports.find(row => row.id === finding.viewportId);
		const binding = await evidenceBinding({ runsRoot, aRunId: aId, bRunId: bId,
			targetId: finding.targetId, viewportId: finding.viewportId, artifact: finding.artifact, rules, runs: [a, b], contentPolicy: { checks: contentChecks ?? b.settings.checks ?? [], expectedLanguage: contentExpectedLanguage ?? b.settings.content?.expectedLanguage ?? null } });
		finding.evidenceFingerprint = binding.fingerprint;
		const accepted = report.known_diffs[key].find(record => record.target === finding.targetId
			&& record.viewport === finding.viewportId && record.artifact === finding.artifact && record.fingerprint === binding.fingerprint
			&& Object.keys(binding.evidence).every(key => record.evidence[key] === binding.evidence[key]));
		const normalization = finding.artifact === 'html' && row.artifacts.html.diff?.rawChanged && !row.artifacts.html.diff.changed;
		if (accepted && entry.judge !== 'oracle') {
			finding.causeId = accepted.cause;
			finding.acceptance = { ...binding, policyHash: binding.evidence.policyHash, evidence: undefined, sources: undefined };
			if (!report.causes.some(cause => cause.id === accepted.cause)) report.causes.push({ id: accepted.cause, title: accepted.cause, detail: accepted.reason, known: true, acceptance: 'recorded-evidence' });
		} else if (normalization) {
			const id = '@normalization/' + finding.targetId + '/' + finding.viewportId;
			finding.causeId = id;
			finding.acceptance = { ...binding, policyHash: binding.evidence.policyHash, evidence: undefined, sources: undefined, ruleIds: row.artifacts.html.diff.firedRuleIds };
			report.causes.push({ id, title: 'Evidenced HTML normalization', known: true, acceptance: 'normalization' });
		}
	}
	const problems = validateReport(report);
	if (problems.length) throw new Error(problems.join(' '));
	const reportPath = join(output, 'report.json');
	const serialized = Buffer.from(JSON.stringify(report));
	if (serialized.length > 16_000_000) throw new Error('Report exceeds the 16 MB reader limit. Compare fewer targets or viewports. Detailed evidence remains in local sidecars.');
	await writeFile(reportPath, serialized);
	return { report, reportPath, exitCode };
}
