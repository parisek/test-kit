// Pure builders for the four decision actions of a finding (docs/viewer-workflow.md,
// "Decision actions", #153 D15). The viewer cannot run a command or write a file, so
// each action is text to copy. Copying stores nothing (R5.3, R11.5).
// Report data is untrusted: a value goes into a command only when it is a plain id or
// a plain relative path, so the copied text never needs shell quoting.
import { buildDeepLink } from './deep-link.js';
import { relativePath } from '../../../src/report/safe.js';
import { isHash } from '../../../src/rules/model.js';

const RECORDABLE = ['screenshot', 'html', 'status', 'content'];
const EVIDENCE = ['screenshot', 'html', 'status', 'content', 'behavior', 'lighthouse'];
const PLAIN_ID = /^[A-Za-z0-9_@][A-Za-z0-9._@-]{0,159}$/;
const plain = (value) => (typeof value === 'string' && PLAIN_ID.test(value) ? value : null);

// The page URL without its hash, plus the hash of the finding in the Evidence view.
export function findingLink(finding, { reportId = null, page = '' } = {}) {
	const hash = buildDeepLink({
		reportId,
		view: 'evidence',
		targetId: finding?.targetId ?? null,
		viewportId: finding?.viewportId ?? null,
		artifact: EVIDENCE.includes(finding?.artifact) ? finding.artifact : null,
		findingId: finding?.id ?? null,
	}, { adjacent: !reportId });
	if (hash === null) return null;
	return `${String(page).split('#')[0]}${hash}`;
}

// The report path as the viewer loaded it, relative to the page, when that is a plain
// relative path. A published history loads reports/<id>/report.json, a single report
// loads report.json. Anything else gives the placeholder REPORT.
export function reportArgument(source, page = '') {
	if (typeof source !== 'string') return 'REPORT';
	try {
		const base = new URL('.', page);
		const url = new URL(source, base);
		if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return 'REPORT';
		return relativePath(decodeURIComponent(url.pathname.slice(base.pathname.length))) ?? 'REPORT';
	} catch {
		return 'REPORT';
	}
}

export function knownCommand(finding, { source = null, page = '', basis = 'relative' } = {}) {
	// R7.3: a known difference applies to a relative check only. An absolute finding uses the allowlist and record-allowed (R9.12).
	if (basis === 'absolute') return null;
	const target = plain(finding?.targetId);
	const viewport = plain(finding?.viewportId);
	if (!target || !viewport || !RECORDABLE.includes(finding?.artifact)) return null;
	return `test-kit record-known ${reportArgument(source, page)} --config FILE --target ${target} --viewport ${viewport} --artifact ${finding.artifact} --cause ID --reason TEXT`;
}

// R9.12: the command that records an allowlist entry for one unexplained absolute finding. Copying it records nothing (R5.3).
// `--fingerprint` selects exactly this finding when several share the check, the target and the viewport.
// Returns { text, reason }: text is null when the finding has no fingerprint or an id is not plain.
export function allowedCommand(finding, { source = null, page = '' } = {}) {
	if (!isHash(finding?.evidenceFingerprint)) return { text: null, reason: 'This finding has no evidence fingerprint, so an allowlist entry cannot match it. A speed budget changes in the config.' };
	const target = plain(finding?.targetId);
	const check = plain(finding?.checkId);
	const viewport = finding?.viewportId == null ? null : plain(finding.viewportId);
	if (!target || !check || (finding.viewportId != null && !viewport)) return { text: null, reason: 'Only a finding with a plain target, check and viewport id can be recorded.' };
	return { text: `test-kit record-allowed ${reportArgument(source, page)} --config FILE --target ${target} --check ${check}${viewport ? ` --viewport ${viewport}` : ''} --fingerprint ${finding.evidenceFingerprint} --reason TEXT --owner TEXT`, reason: null };
}

export function recaptureCommand(finding) {
	const target = plain(finding?.targetId);
	const viewport = plain(finding?.viewportId);
	if (!target || !viewport) return null;
	return `test-kit run --config FILE --target ${target} --viewport ${viewport}`;
}

// The four actions in the order of the workflow. An action without text says why.
export function decisionActions(finding, options = {}) {
	const link = findingLink(finding, options);
	const known = knownCommand(finding, options);
	const recapture = recaptureCommand(finding);
	const allowed = options.basis === 'absolute' && !options.explained ? allowedCommand(finding, options) : null;
	return [
		{ id: 'fix', label: 'Fix', button: 'Copy link', text: link, reason: link ? null : 'This finding has no valid link.' },
		{ id: 'known', label: 'Known difference', button: 'Copy command', text: known,
			reason: known ? null : options.basis === 'absolute'
				? 'A known difference applies to a relative check only. Allow an absolute finding with the command record-allowed (R9.12).'
				: 'Only a screenshot, HTML, status or content finding with a target and a viewport can be recorded as known.' },
		...(allowed ? [{ id: 'allowed', label: 'Allowlist entry', button: 'Copy command', text: allowed.text, reason: allowed.reason }] : []),
		{ id: 'noise', label: 'Noise or unstable', button: 'Copy re-capture command', text: recapture,
			reason: recapture ? null : 'A re-capture needs a target and a viewport.' },
		{ id: 'pass', label: 'Pass on', button: 'Copy link', text: link, reason: link ? null : 'This finding has no valid link.' },
	];
}
