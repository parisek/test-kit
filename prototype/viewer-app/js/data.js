// Loading and normalising a report. One entry point, `adaptReport`, accepts version 1 and version 2.
// Absence of `schemaVersion` means version 1. Anything newer than this viewer knows is refused with a message.
import { adaptV1 } from './adapt-v1.js';
import { VIEW_IDS, PAIR_KINDS } from './pairs.js';
import { normalizeRules, RULE_ARTIFACTS } from './rules.js';
import { composedIds } from './classify.js';

const STEP_STATUS = ['same', 'changed', 'failed'];
const EVIDENCE_KINDS = ['screenshot', 'console', 'network', 'datalayer', 'dom'];

export const SUPPORTED_SCHEMA = 2;

export class ReportError extends Error {
	constructor(message, problems = []) {
		super(message);
		this.name = 'ReportError';
		this.problems = problems;
	}
}

export async function loadReport(url, fetchImpl = globalThis.fetch) {
	let response;
	try {
		response = await fetchImpl(url, { cache: 'no-store' });
	} catch (error) {
		throw new ReportError(`Report se nepodařilo načíst z ${url}. Aplikace potřebuje file server (fetch odmítá file://).`, [String(error)]);
	}
	if (!response.ok) throw new ReportError(`Report ${url} vrátil HTTP ${response.status}.`);
	let json;
	try {
		json = await response.json();
	} catch (error) {
		throw new ReportError(`Report ${url} není platný JSON.`, [String(error)]);
	}
	return adaptReport(json);
}

export function adaptReport(json) {
	if (!json || typeof json !== 'object') throw new ReportError('Report je prázdný.');
	const version = json.schemaVersion ?? 1;
	if (version > SUPPORTED_SCHEMA) throw new ReportError(`Report má schemaVersion ${version}, prohlížeč umí nejvýše ${SUPPORTED_SCHEMA}.`);
	const report = version >= 2 ? normalize(json) : adaptV1(json);
	const problems = validate(report);
	if (problems.length) throw new ReportError('Report je nekonzistentní.', problems);
	return report;
}

function normalize(json) {
	const viewports = json.meta?.viewports ?? [];
	return {
		schemaVersion: json.schemaVersion,
		legacy: false,
		meta: { project: '', title: 'Porovnání běhů', description: '', generated: null, primaryViewport: viewports[0]?.id ?? null, matchBelow: 0.5, note: '', ...json.meta, viewports },
		runs: json.runs ?? [],
		pair: json.pair ?? { kind: PAIR_KINDS[0].id, aRunId: null, bRunId: null },
		entries: (json.entries ?? []).map((entry) => ({ kind: 'page', judge: null, note: null, artifacts: {}, ...entry, viewports: entry.viewports ?? [] })),
		causes: json.causes ?? [],
		findings: json.findings ?? [],
		rules: normalizeRules(json.rules),
	};
}

export function validate(report) {
	const problems = [];
	const viewportIds = new Set(report.meta.viewports.map((viewport) => viewport.id));
	if (!Array.isArray(report.entries)) problems.push('entries není pole.');
	const targetIds = new Set(report.entries.map((entry) => entry.id));
	if (targetIds.size !== report.entries.length) problems.push('Dva cíle mají stejné id.');
	const causeIds = new Set(report.causes.map((cause) => cause.id));
	for (const entry of report.entries) {
		for (const viewport of entry.viewports) if (!viewportIds.has(viewport.id)) problems.push(`Cíl ${entry.id}: neznámý viewport ${viewport.id}.`);
	}
	for (const finding of report.findings) {
		if (!targetIds.has(finding.targetId)) problems.push(`Nález ${finding.id ?? '?'}: neznámý cíl ${finding.targetId}.`);
		if (!causeIds.has(finding.causeId)) problems.push(`Nález ${finding.id ?? '?'}: neznámá příčina ${finding.causeId}.`);
		if (finding.viewportId != null && !viewportIds.has(finding.viewportId)) problems.push(`Nález ${finding.id ?? '?'}: neznámý viewport ${finding.viewportId}.`);
	}
	if (report.pair?.kind && !PAIR_KINDS.some((kind) => kind.id === report.pair.kind)) problems.push(`Neznámý druh páru ${report.pair.kind}.`);
	problems.push(...validateRules(report), ...validateBehavior(report));
	// A version 1 page may list components the report never compared, so only version 2 must resolve.
	if (!report.legacy) {
		for (const entry of report.entries) {
			for (const id of composedIds(entry)) if (!targetIds.has(id)) problems.push(`Cíl ${entry.id}: composedOf obsahuje neznámý cíl ${id}.`);
		}
	}
	return problems;
}

function validateRules(report) {
	const problems = [];
	for (const [id, rule] of Object.entries(report.rules ?? {})) {
		for (const pair of rule.applies?.pairs ?? []) if (!PAIR_KINDS.some((kind) => kind.id === pair)) problems.push(`Pravidlo ${id}: neznámý druh páru ${pair}.`);
		for (const artifact of rule.applies?.artifacts ?? []) if (!RULE_ARTIFACTS.includes(artifact)) problems.push(`Pravidlo ${id}: neznámý artefakt ${artifact}.`);
	}
	return problems;
}

function validateBehavior(report) {
	const problems = [];
	for (const entry of report.entries) {
		for (const step of entry.artifacts?.behavior?.steps ?? []) {
			if (!STEP_STATUS.includes(step.status)) problems.push(`Cíl ${entry.id}, krok ${step.id ?? '?'}: neznámý stav ${step.status}.`);
			for (const evidence of step.evidence ?? []) {
				if (!EVIDENCE_KINDS.includes(evidence.kind)) problems.push(`Cíl ${entry.id}, krok ${step.id ?? '?'}: neznámý druh důkazu ${evidence.kind}.`);
			}
		}
	}
	return problems;
}

export { VIEW_IDS };
