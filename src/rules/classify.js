import { isHash, ruleApplies } from './model.js';
export function findingIsExplained(report, finding) {
  const cause = report.causes.find(cause => cause.id === finding.causeId);
  if (cause?.known !== true) return false;
  if (!Object.hasOwn(cause, 'acceptance')) return report.meta?.comparisonPolicyHash === undefined; // Legacy unscoped causes retain their contract.
  const accepted = finding.acceptance;
  if (!accepted || !isHash(accepted.fingerprint) || accepted.fingerprint !== finding.evidenceFingerprint || accepted.aRunId !== report.pair.aRunId || accepted.bRunId !== report.pair.bRunId || accepted.pairKey !== report.pair.key
    || accepted.targetId !== finding.targetId || accepted.viewportId !== finding.viewportId || accepted.artifact !== finding.artifact) return false;
  if (cause.acceptance === 'normalization') {
    const target = report.entries?.find(entry => entry.id === finding.targetId);
    const diff = target?.viewports.find(row => row.id === finding.viewportId)?.artifacts?.html?.diff;
    return diff?.rawChanged === true && diff.changed === false && diff.policyHash === report.meta?.comparisonPolicyHash
      && accepted.policyHash === report.meta?.comparisonPolicyHash
      && Array.isArray(accepted.ruleIds) && Array.isArray(diff.firedRuleIds) && diff.firedRuleIds.length === accepted.ruleIds.length
      && diff.firedRuleIds.every(id => accepted.ruleIds.includes(id))
      && finding.artifact === 'html' && Array.isArray(accepted.ruleIds) && accepted.ruleIds.length <= 50 && new Set(accepted.ruleIds).size === accepted.ruleIds.length && accepted.ruleIds.length > 0
      && accepted.ruleIds.every(id => typeof id === 'string' && Object.hasOwn(report.rules ?? {}, id) && ruleApplies(report.rules?.[id], { pairKey: report.pair.key, kind: report.pair.kind, targetId: finding.targetId, artifact: finding.artifact }));
  }
  if (cause.acceptance !== 'recorded-evidence') return false;
  const records = report.known_diffs?.[report.pair.key];
  return Array.isArray(records) && records.some(record => record && record.target === finding.targetId
    && record.viewport === finding.viewportId && record.artifact === finding.artifact
    && record.cause === cause.id && record.fingerprint === accepted.fingerprint && record.evidence?.policyHash === accepted.policyHash && accepted.policyHash === report.meta?.comparisonPolicyHash);
}
