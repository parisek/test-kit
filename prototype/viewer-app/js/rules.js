// Normaliser rules, scoped to the situation. PURE. Tests: tests/rules.test.js.
//
// report.rules is { ruleId: string | { text, evidence?, applies? } }. A bare string is a legacy rule that applies
// everywhere. `applies` narrows a rule; every list that is present must contain the current value:
//   pairs      pair kind ids (js/pairs.js)       artifacts  'html' | 'status' | 'behavior' | 'screenshot'
//   kinds      target kinds ('page', 'component') targets    target ids
// A missing list means "no limit on that axis".
export const RULE_ARTIFACTS = ['html', 'status', 'behavior', 'screenshot'];

export function normalizeRules(rules) {
	const out = {};
	for (const [id, rule] of Object.entries(rules ?? {})) {
		out[id] = typeof rule === 'string'
			? { text: rule, evidence: null, applies: {} }
			: { text: '', evidence: null, ...rule, applies: { ...(rule?.applies ?? {}) } };
	}
	return out;
}

/** Does the rule's scope cover this situation? */
export function ruleApplies(rule, { pairKind, targetKind, artifact, targetId }) {
	const { pairs, artifacts, kinds, targets } = rule.applies ?? {};
	return (!pairs || pairs.includes(pairKind))
		&& (!artifacts || artifacts.includes(artifact))
		&& (!kinds || kinds.includes(targetKind))
		&& (!targets || targets.includes(targetId));
}

/** Rule ids a target's artifact rows say they used: the `noise` and `known` keys of the rows. */
export function firedRuleIds(target, artifact) {
	const rows = target.artifacts?.[artifact]?.rows ?? [];
	return [...new Set(rows.flatMap((row) => [row.noise, row.known]).filter(Boolean))];
}

/**
 * The rules to show for one target, one artifact, one pair kind.
 *   used    fired on this target and in scope. These explain what the diff hides.
 *   others  in scope but did not fire here. Shown collapsed, never the whole catalogue.
 * A rule that is out of scope appears in neither list.
 */
export function rulesFor(report, target, pairKind, artifact = 'html') {
	const situation = { pairKind, targetKind: target.kind, artifact, targetId: target.id };
	const fired = new Set(firedRuleIds(target, artifact));
	const used = [];
	const others = [];
	for (const [id, rule] of Object.entries(report.rules ?? {})) {
		if (!ruleApplies(rule, situation)) continue;
		if (fired.has(id)) used.push({ id, text: rule.text, evidence: rule.evidence ?? null });
		else others.push({ id, text: rule.text });
	}
	return { used, others };
}
