// `record-allowed`: the command that adds one entry to the allowlist (R5.3, R9.12).
// It is the counterpart of `record-known`. It is a command, not a viewer action.
import { resolve, dirname, basename } from 'node:path';
import { adaptReport } from '../report/model.js';
import { findingBasis } from '../report/catalog.js';
import { artifactState } from '../report/classify.js';
import { readSidecar } from '../artifacts/compare.js';
import { isHash } from '../rules/model.js';
import { normalizeAllowlist } from './model.js';
import { allowlistPath, appendEntry } from './file.js';

const shown = (value) => String(value).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 80);

export async function recordAllowed({ reportPath, target, check, viewport, fingerprint, reason, owner, expires, configPath, allowlist: override }) {
	// Validate the text first. A bad reason fails before any file is read.
	const entry = { checkId: check, targetId: target, fingerprint: 'sha256:' + '0'.repeat(64), reason, owner, ...(expires !== undefined ? { expires } : {}) };
	try { normalizeAllowlist({ schemaVersion: 1, entries: [entry] }); } catch (error) { throw new Error(error.message.replace(/^Invalid allowlist: (entry 1: )?/, 'Invalid allowlist entry: ')); }
	if (fingerprint != null && !isHash(fingerprint)) throw new Error('--fingerprint must be sha256: and 64 lowercase hex digits.');
	const reportFile = resolve(reportPath);
	const report = adaptReport(JSON.parse(await readSidecar(dirname(reportFile), basename(reportFile), 16_000_000)));
	const row = report.entries.find((item) => item.id === target);
	if (!row) throw new Error('Unknown target.');
	if (row.judge === 'oracle') throw new Error('An oracle target takes no allowlist entry.');
	if (viewport != null && !row.viewports.some((item) => item.id === viewport)) throw new Error('Unknown target viewport.');
	if (!Object.hasOwn(report.checks ?? {}, check)) throw new Error('The check is not in the catalog of the report.');
	if (report.checks[check].basis !== 'absolute') throw new Error('An allowlist entry applies to an absolute check only (R7.3). Use record-known for a relative finding.');
	// R9.12: a speed budget changes in the config. Its finding has no fingerprint and no entry can explain it.
	if (check === 'lighthouse-budget') throw new Error('A speed budget finding takes no allowlist entry (R9.12). Change the budget in the config.');
	const found = report.findings.filter((finding) => finding.targetId === target && finding.checkId === check
		&& (viewport == null ? finding.viewportId == null : finding.viewportId === viewport) && findingBasis(report, finding) === 'absolute'
		&& (fingerprint == null || finding.evidenceFingerprint === fingerprint));
	if (!found.length) throw new Error(fingerprint == null ? 'No finding of this check on this target and viewport. Name --viewport when the finding has one.'
		: 'No finding of this check on this target and viewport has this fingerprint. Name --viewport when the finding has one.');
	if (found.length > 1) {
		const prints = found.map((finding) => finding.evidenceFingerprint).filter(isHash).slice(0, 5);
		throw new Error(`${found.length} findings match. Record one entry for one finding. Select one with --fingerprint HASH. The fingerprints are: ${prints.join(', ') || 'none'}.`);
	}
	const [finding] = found;
	if (!isHash(finding.evidenceFingerprint)) throw new Error(`The finding has no evidence fingerprint. ${shown(finding.diagnostic ?? 'It cannot be allowlisted.')}`);
	if (artifactState(row, finding.viewportId ?? null, finding.artifact) !== 'complete') throw new Error('The artifact of this finding is not complete. Run the check again before recording.');
	const added = { ...entry, fingerprint: finding.evidenceFingerprint, ...(typeof finding.message === 'string' && finding.message.length <= 300 && !/[\x00-\x1f\x7f]/.test(finding.message) ? { message: finding.message } : {}) };
	const file = allowlistPath({ configPath, override });
	const entries = await appendEntry(file, added);
	return { checkId: check, targetId: target, fingerprint: finding.evidenceFingerprint, allowlist: file, entries,
		next: 'Run the comparison again. Existing reports are unchanged.' };
}
