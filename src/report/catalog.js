// Pure constants and helpers for the checks catalog of a report (R7.2, R8.10, R9.8).
// The viewer bundles this file. It imports no check module, no Node module and no DOM.
export const BASES = Object.freeze(['absolute', 'relative']);
export const LAYERS = Object.freeze(['package', 'project', 'component', 'page']);
export const ENTRY_KINDS = Object.freeze(['page', 'component', 'project']);
// The reserved id of the project entry that holds lint findings with no component (R9.11).
export const PROJECT_TARGET = '@project';
// Artifacts of a pair comparison. Each has side A, side B and a difference.
export const RELATIVE_ARTIFACTS = Object.freeze(['screenshot', 'html', 'status', 'content', 'behavior', 'lighthouse']);
// Artifacts that exist only as an absolute result of one run (R9.9).
export const ABSOLUTE_ARTIFACTS = Object.freeze(['lint', 'a11y']);
export const ARTIFACT_KINDS = Object.freeze([...RELATIVE_ARTIFACTS, ...ABSOLUTE_ARTIFACTS]);
// A finding of these artifacts has no checkId and the basis `relative` (R8.11).
export const IMPLICIT_ARTIFACTS = Object.freeze(['screenshot', 'html', 'status']);
// A finding of these artifacts sits at target scope. It has no viewport (R9.11).
export const TARGET_SCOPE_ARTIFACTS = Object.freeze(['lint']);
export const CHECK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// The six built-in content checks. A test compares this table with `src/checks`.
export const BUILTIN_CONTENT_CHECKS = Object.freeze({
	'heading-outline': Object.freeze({ basis: 'absolute', layer: 'package', title: 'Heading outline' }),
	lang: Object.freeze({ basis: 'absolute', layer: 'package', title: 'Declared page language' }),
	'empty-alt': Object.freeze({ basis: 'absolute', layer: 'package', title: 'Image alternative text' }),
	'empty-title': Object.freeze({ basis: 'absolute', layer: 'package', title: 'Page title' }),
	'internal-links': Object.freeze({ basis: 'absolute', layer: 'package', title: 'Stored internal link responses' }),
	'text-difference': Object.freeze({ basis: 'relative', layer: 'package', title: 'Stored text difference' }),
});

// The two Lighthouse checks. `cause` of a speed finding picks one (ADR 0004, "Speed").
export const LIGHTHOUSE_CHECKS = Object.freeze({
	'lighthouse-change': Object.freeze({ basis: 'relative', layer: 'package', title: 'Speed change beyond noise' }),
	'lighthouse-budget': Object.freeze({ basis: 'absolute', layer: 'project', title: 'Speed budget' }),
});
export const LIGHTHOUSE_CAUSE_CHECK = Object.freeze({ 'performance-change': 'lighthouse-change', 'performance-budget': 'lighthouse-budget' });

// Behavior identity (owner decision of 2026-11-04, ADR 0004 question 1).
// A contract name allows no dot, so a behavior key cannot collide with another check id.
export const BEHAVIOR_PREFIX = 'behavior.';
export const behaviorCheckId = (contract) => `${BEHAVIOR_PREFIX}${contract}`;
// The entry that an adapted version 2 report uses for behavior findings. The old
// finding names a step id, and a step id cannot be parsed back to its contract.
// A new report writes this key only when it compares two stored behavior runs of version 1. A new run names its contract.
export const LEGACY_BEHAVIOR_ID = 'behavior';
export const LEGACY_BEHAVIOR_CHECK = Object.freeze({ basis: 'relative', layer: 'project', title: 'Behavior (contract not recorded)' });
// The origin of a behavior contract is its layer in the catalog.
export const BEHAVIOR_ORIGINS = Object.freeze(['package', 'project', 'component']);

export const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The basis of the check that made a finding.
// A report with no catalog (an object from before version 3) treats every check as relative.
// A check that the catalog does not list gives `absolute`, so the finding never reads as explained.
export function findingBasis(report, finding) {
	if (!finding?.checkId) return 'relative';
	if (!isPlain(report?.checks)) return 'relative';
	const entry = report.checks[finding.checkId];
	return isPlain(entry) && BASES.includes(entry.basis) ? entry.basis : 'absolute';
}

// The layer shown for a finding: its own, else the layer of its catalog entry, else `package`.
export function findingLayer(report, finding) {
	if (LAYERS.includes(finding?.layer)) return finding.layer;
	const entry = finding?.checkId && isPlain(report?.checks) ? report.checks[finding.checkId] : null;
	return LAYERS.includes(entry?.layer) ? entry.layer : 'package';
}
