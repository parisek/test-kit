// `record-decision`: the command that adds one decision for a layout difference of a design pair (R5.3, R9.14).
// It is modelled on `record-allowed`. It is a command, not a viewer action.
import { resolve, dirname, basename } from 'node:path';
import { adaptReport } from '../report/model.js';
import { readSidecar } from '../artifacts/compare.js';
import { validateLayoutComparison, MAX_COMPARISON_BYTES } from '../layout/compare.js';
import { normalizeDecisions } from './model.js';
import { decisionFingerprint } from './fingerprint.js';
import { decisionsPath, appendDecision } from './file.js';

// The side of the pair that holds the design: run B when it is a design run (in a drift pair, the newer import),
// else run A. The report copies the side declaration of each run, so its `kind` decides. Null without a design run.
export function designSideOf(report) {
	const kind = (id) => {
		const run = report.runs.find((item) => item?.id === id);
		return run?.settings?.sides?.[run.side]?.kind;
	};
	if (kind(report.pair.bRunId) === 'design') return 'b';
	if (kind(report.pair.aRunId) === 'design') return 'a';
	return null;
}

export async function recordDecision({ reportPath, target, viewport, part, property, decision, reason, owner, configPath, decisions: override }) {
	// Validate the text first. A bad decision, reason or owner fails before any file is read.
	const entry = { targetId: target, viewportId: viewport, part, property, decision, designValue: null, fingerprint: 'sha256:' + '0'.repeat(64), reason, owner };
	try { normalizeDecisions({ schemaVersion: 1, entries: [entry] }); } catch (error) { throw new Error(error.message.replace(/^Invalid decisions: (entry 1: )?/, 'Invalid decision: ')); }
	const reportFile = resolve(reportPath);
	const root = dirname(reportFile);
	const report = adaptReport(JSON.parse(await readSidecar(root, basename(reportFile), 16_000_000)));
	if (!report.pair) throw new Error('A decision needs a pair report with a design run.');
	const side = designSideOf(report);
	if (!side) throw new Error('The report has no design run, so a difference has no design value. A decision applies to a pair with a design side.');
	const row = report.entries.find((item) => item.id === target);
	if (!row) throw new Error('Unknown target.');
	if (row.judge === 'oracle') throw new Error('An oracle target takes no decision.');
	const cell = row.viewports.find((item) => item.id === viewport);
	if (!cell) throw new Error('Unknown target viewport.');
	const index = cell.artifacts?.layout;
	if (!index) throw new Error('The cell has no layout artifact.');
	if (index.state !== 'complete' || typeof index.diff?.src !== 'string') throw new Error('The layout artifact of this cell is not complete. Compare again before recording.');
	// The report index lists the first 50 differences only. The sidecar holds the list up to its byte bound.
	const detail = validateLayoutComparison(JSON.parse(await readSidecar(root, index.diff.src, MAX_COMPARISON_BYTES)));
	const difference = detail.differences.find((item) => item.part === part && item.property === property);
	if (!difference) throw new Error(detail.differencesOmitted > 0
		? 'No listed layout difference has this part and property. The sidecar left some differences out at its byte bound.'
		: 'No layout difference of this cell has this part and property.');
	const designValue = difference[side];
	const fingerprint = decisionFingerprint({ targetId: target, viewportId: viewport, part, property, designValue });
	const file = decisionsPath({ configPath, override });
	const entries = await appendDecision(file, { ...entry, designValue, fingerprint });
	return { targetId: target, viewportId: viewport, part, property, decision, designValue, fingerprint, decisions: file, entries,
		next: 'Run the comparison again. Existing reports are unchanged.' };
}
