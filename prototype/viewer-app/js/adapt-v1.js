// Reads a report written by the existing build-report.js (schemaVersion absent, "version 1") into the
// version 2 model. Additive on purpose: nothing a version 1 report says is dropped.
// `judge: oracle` stays on the entry; the classifier never colours such a row by ratio.
const COMPASS_MATCH_BELOW = 3; // percent, the doctrine's compass threshold for a screenshot compare

function sizeFromId(id) {
	const width = Number(String(id).match(/(\d{3,4})$/)?.[1]) || null;
	return { width, height: null };
}

export function adaptV1(json) {
	const meta = json.meta ?? {};
	const viewports = (meta.viewports ?? []).map((viewport) => ({ id: viewport.id, label: viewport.label ?? viewport.id, ...sizeFromId(viewport.id) }));
	const entries = (json.entries ?? []).map((entry) => ({
		id: entry.id,
		kind: entry.kind ?? 'component',
		title: entry.title ?? entry.id,
		path: entry.selector ?? entry.source ?? entry.title ?? entry.id,
		group: entry.category ?? entry.kind ?? 'other',
		judge: entry.judge ?? null,
		note: entry.note ?? null,
		composedOf: entry.composedOf ?? null,
		comparedAt: entry.comparedAt ?? null,
		viewports: (entry.viewports ?? []).map((viewport) => ({
			id: viewport.id,
			label: viewport.label ?? viewport.id,
			ratio: viewport.ratio ?? 0,
			error: viewport.error ?? null,
			selectorMissing: Boolean(viewport.selectorMissing),
			overflow: viewport.overflow ?? null,
			size: { target: viewport.target ?? null, render: viewport.render ?? null },
			shots: viewport.shots ?? null,
			artifacts: {
				screenshot: {
					a: viewport.shots?.target ? { src: viewport.shots.target } : null,
					b: viewport.shots?.render ? { src: viewport.shots.render } : null,
					diff: viewport.shots?.diff ? { src: viewport.shots.diff, ratio: viewport.ratio ?? 0 } : null,
				},
			},
		})),
		artifacts: entry.consoleErrors?.length
			? { behavior: { note: 'Chyby konzole při snímání.', rows: entry.consoleErrors.map((message) => ({ n: 'Chyba konzole', a: '', b: String(message), st: 'ne' })) } }
			: {},
	}));
	return {
		schemaVersion: 1,
		legacy: true,
		meta: {
			project: meta.project ?? '',
			title: meta.title ?? 'Vizuální porovnání',
			description: meta.description ?? '',
			generated: meta.generated ?? null,
			primaryViewport: meta.primaryViewport ?? viewports[0]?.id ?? null,
			matchBelow: COMPASS_MATCH_BELOW,
			viewports,
			note: 'Report ve starém formátu (verze 1). Příčiny a běhy se nezobrazují, protože v něm nejsou.',
		},
		runs: [
			{ id: 'reference', side: 'reference', label: meta.reference ?? 'reference', at: meta.generated ?? null, captures: entries.length },
			{ id: 'render', side: 'styleguide', label: 'styleguide · render', at: meta.generated ?? null, captures: entries.length },
		],
		pair: { kind: 'reference-styleguide', aRunId: 'reference', bRunId: 'render' },
		entries,
		causes: [],
		findings: [],
		rules: {},
	};
}
