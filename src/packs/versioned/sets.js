// Pure. Contract sets keyed by library major, and the pack that runs the matching set (R13.42, vision layers rule 5).
// A set is data plus check functions. No DOM, no file system (R4.4). Nothing runs by default (R5.1).
import { definePack, dense, isText } from '../define.js';
import { detectMajor } from './version.js';
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const STATUSES = ['verified', 'placeholder'];
const PLACEHOLDER_OWNER = /^(todo|tbd|fixme|xxx|unknown|none|n\/a|placeholder|owner)$/i;
const RELEASE = /^(0|[1-9]\d{0,3})\.\d{1,6}\.\d{1,6}$/;

// A contract: { id, title, check(value, facts) -> [{ severity, message, evidence }] }. `facts` is the data of the set.
export function defineContractSet(set) {
  if (!set || typeof set !== 'object') throw new Error('A contract set must be an object.');
  const { library, major, owner, status, verifiedAgainst, sources: rawSources, facts, contracts: rawContracts } = set; // one read of each field
  if (typeof library !== 'string' || !ID.test(library)) throw new Error('A contract set needs a lowercase kebab-case library name.');
  if (!Number.isSafeInteger(major) || major < 0 || major > 9999) throw new Error(`Set ${library} needs a whole major number.`);
  if (!isText(owner) || PLACEHOLDER_OWNER.test(owner.trim())) throw new Error(`Set ${library} ${major} needs a named owner.`);
  if (!STATUSES.includes(status)) throw new Error(`Set ${library} ${major} needs status verified or placeholder.`);
  // Each caller list is copied once. The copy is validated and stored.
  const sources = rawSources === undefined ? [] : dense(rawSources, `Set ${library} ${major} sources`, 20);
  if (!sources.every(item => isText(item, 300))) throw new Error(`Set ${library} ${major} has a bad source.`);
  if (status === 'verified') {
    if (typeof verifiedAgainst !== 'string' || !RELEASE.test(verifiedAgainst) || Number(verifiedAgainst.split('.')[0]) !== major) throw new Error(`Verified set ${library} ${major} must name an exact release of major ${major} it was verified against.`);
    if (sources.length === 0) throw new Error(`Verified set ${library} ${major} must list its sources.`);
  }
  if (!facts || typeof facts !== 'object') throw new Error(`Set ${library} ${major} needs facts.`);
  const listed = dense(rawContracts, `Set ${library} ${major} contracts`, 100);
  if (listed.length === 0) throw new Error(`Set ${library} ${major} needs 1 to 100 contracts.`);
  const contracts = [];
  for (const item of listed) {
    const { id, title, check } = item ?? {}; // one read of each field
    if (typeof id !== 'string' || !ID.test(id) || id.length > 48) throw new Error(`Set ${library} ${major} has a contract with a bad id.`);
    if (!isText(title)) throw new Error(`Contract ${id} needs a title.`);
    if (typeof check !== 'function') throw new Error(`Contract ${id} needs a check function.`);
    contracts.push(Object.freeze({ id, title, check }));
  }
  if (new Set(contracts.map(item => item.id)).size !== contracts.length) throw new Error(`Set ${library} ${major} has a duplicate contract id.`);
  return Object.freeze({
    library, major, owner, status, verifiedAgainst: status === 'verified' ? verifiedAgainst : null,
    sources: Object.freeze(sources), facts: Object.freeze(structuredClone(facts)), contracts: Object.freeze(contracts),
  });
}

// Picks the set for a detected version. It never falls back to another major (R8.7, R8.9).
// Returns { state: 'selected' | 'unknown' | 'unsupported', detection, set?, diagnostic? }.
export function selectContractSet(sets, input) {
  const detection = detectMajor(input);
  const supported = sets.map(item => item.major);
  if (detection.state !== 'detected') return { state: 'unknown', detection, supported, diagnostic: detection.diagnostic };
  const set = sets.find(item => item.major === detection.major);
  if (!set) return { state: 'unsupported', detection, supported, diagnostic: `Major ${detection.major} has no contract set. Supported majors: ${supported.join(', ')}.` };
  return { state: 'selected', detection, supported, set };
}

const open = (library, selection, message) => ({
  severity: 'error', message,
  evidence: { state: 'unknown', library, detectedVersion: selection.detection.version, source: selection.detection.source, supportedMajors: selection.supported },
});
const provenance = (selection) => ({
  library: selection.set.library, major: selection.set.major, detectedVersion: selection.detection.version, source: selection.detection.source,
  owner: selection.set.owner, status: selection.set.status, verifiedAgainst: selection.set.verifiedAgainst,
});

// Builds a pack from contract sets of one library. Every set must hold the same contract ids, so a major cannot skip a contract.
// The version is read from `context.versions[library]` as { version, source }. A component check: it needs `context.components` to list the library.
export function defineVersionedPack(options) {
  if (!options || typeof options !== 'object') throw new Error('A versioned pack needs options.');
  const { id, title, owner, library, artifact = 'behavior', sets: rawSets } = options; // one read of each field
  if (typeof artifact !== 'string' || !ID.test(artifact)) throw new Error(`Pack ${id} needs an artifact name.`);
  if (typeof owner === 'string' && PLACEHOLDER_OWNER.test(owner.trim())) throw new Error(`Pack ${id} needs a named owner.`);
  const listedSets = dense(rawSets, `Pack ${id} sets`, 50);
  if (listedSets.length === 0) throw new Error(`Pack ${id} needs contract sets.`);
  const sets = listedSets.map(defineContractSet);
  if (sets.some(item => item.library !== library)) throw new Error(`Pack ${id}: every set must be for ${library}.`);
  if (new Set(sets.map(item => item.major)).size !== sets.length) throw new Error(`Pack ${id} has two sets for one major.`);
  const ids = sets[0].contracts.map(item => item.id).sort();
  if (sets.some(item => item.contracts.map(c => c.id).sort().join() !== ids.join())) throw new Error(`Pack ${id}: every set must declare the same contract ids.`);
  for (const item of sets) {
    for (const contract of item.contracts) {
      if (contract.title !== sets[0].contracts.find(c => c.id === contract.id).title) throw new Error(`Pack ${id}: contract ${contract.id} has a different title in set ${item.major}.`);
    }
  }
  const applies = { artifacts: [artifact], components: [library] };
  const pick = context => selectContractSet(sets, context?.versions?.[library]);
  const checks = [{
    id: `${library}-version`, title: `${library} version selects a contract set`, basis: 'absolute', applies,
    check(value, context) {
      const selection = pick(context);
      if (selection.state !== 'selected') return [open(library, selection, `The ${library} version cannot select a contract set. ${selection.diagnostic} No contract passes.`)];
      const { set } = selection;
      const message = set.status === 'verified'
        ? `The ${library} ${selection.detection.version} contract set ${set.major} applies.`
        : `The ${library} ${selection.detection.version} matches set ${set.major}, but that set is a placeholder. No contract of it proves anything.`;
      return [{ severity: 'info', message, evidence: provenance(selection) }];
    },
  }];
  for (const contractId of ids) {
    checks.push({
      id: `${library}-${contractId}`, title: sets[0].contracts.find(item => item.id === contractId).title, basis: 'absolute', applies,
      check(value, context) {
        const selection = pick(context);
        if (selection.state !== 'selected') return [open(library, selection, `The ${library} version cannot select a contract set. ${selection.diagnostic} This contract did not run.`)];
        const { set } = selection;
        if (set.status !== 'verified') {
          return [{ severity: 'error', message: `The ${library} ${set.major} contract set is a placeholder, so this contract proves nothing.`, evidence: { state: 'incomplete', ...provenance(selection) } }];
        }
        const found = set.contracts.find(item => item.id === contractId).check(value, set.facts);
        if (!Array.isArray(found)) throw new Error('A contract must return a list of findings.');
        return found.map(item => ({ ...item, evidence: { ...item.evidence, contractSet: provenance(selection) } }));
      },
    });
  }
  return definePack({ id, title, owner, checks });
}
