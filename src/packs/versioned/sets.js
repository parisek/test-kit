// Pure. Contract sets keyed by library major, and the pack that runs the matching set (R13.42, vision layers rule 5).
// A set is data plus check functions. No DOM, no file system (R4.4). Nothing runs by default (R5.1).
import { definePack, isText } from '../define.js';
import { detectMajor } from './version.js';
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const STATUSES = ['verified', 'placeholder'];

// A contract: { id, title, check(value, facts) -> [{ severity, message, evidence }] }. `facts` is the data of the set.
export function defineContractSet(set) {
  if (!set || typeof set !== 'object') throw new Error('A contract set must be an object.');
  const { library, major, owner, status, verifiedAgainst, sources, facts, contracts: rawContracts } = set; // one read of each field
  if (typeof library !== 'string' || !ID.test(library)) throw new Error('A contract set needs a lowercase kebab-case library name.');
  if (!Number.isSafeInteger(major) || major < 0 || major > 9999) throw new Error(`Set ${library} needs a whole major number.`);
  if (!isText(owner)) throw new Error(`Set ${library} ${major} needs a named owner.`);
  if (!STATUSES.includes(status)) throw new Error(`Set ${library} ${major} needs status verified or placeholder.`);
  if (status === 'verified' && !isText(verifiedAgainst, 64)) throw new Error(`Verified set ${library} ${major} must name the release it was verified against.`);
  if (status === 'verified' && !(Array.isArray(sources) && sources.length > 0 && sources.length <= 20 && sources.every(item => isText(item, 300)))) throw new Error(`Verified set ${library} ${major} must list its sources.`);
  if (!facts || typeof facts !== 'object') throw new Error(`Set ${library} ${major} needs facts.`);
  if (!Array.isArray(rawContracts) || rawContracts.length === 0 || rawContracts.length > 100) throw new Error(`Set ${library} ${major} needs 1 to 100 contracts.`);
  const contracts = [];
  for (let index = 0; index < rawContracts.length; index += 1) {
    if (!Object.hasOwn(rawContracts, index)) throw new Error(`Set ${library} ${major} has a hole in contracts.`);
    const { id, title, check } = rawContracts[index] ?? {}; // one read of each field
    if (typeof id !== 'string' || !ID.test(id) || id.length > 48) throw new Error(`Set ${library} ${major} has a contract with a bad id.`);
    if (!isText(title)) throw new Error(`Contract ${id} needs a title.`);
    if (typeof check !== 'function') throw new Error(`Contract ${id} needs a check function.`);
    contracts.push(Object.freeze({ id, title, check }));
  }
  if (new Set(contracts.map(item => item.id)).size !== contracts.length) throw new Error(`Set ${library} ${major} has a duplicate contract id.`);
  return Object.freeze({
    library, major, owner, status, verifiedAgainst: verifiedAgainst ?? null,
    sources: Object.freeze([...(sources ?? [])]), facts: Object.freeze(structuredClone(facts)), contracts: Object.freeze(contracts),
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
export function defineVersionedPack({ id, title, owner, library, artifact = 'behavior', sets: rawSets }) {
  if (!Array.isArray(rawSets) || rawSets.length === 0) throw new Error(`Pack ${id} needs contract sets.`);
  const sets = rawSets.map(defineContractSet);
  if (sets.some(item => item.library !== library)) throw new Error(`Pack ${id}: every set must be for ${library}.`);
  if (new Set(sets.map(item => item.major)).size !== sets.length) throw new Error(`Pack ${id} has two sets for one major.`);
  const ids = sets[0].contracts.map(item => item.id).sort();
  if (sets.some(item => item.contracts.map(c => c.id).sort().join() !== ids.join())) throw new Error(`Pack ${id}: every set must declare the same contract ids.`);
  const applies = { artifacts: [artifact], components: [library] };
  const pick = context => selectContractSet(sets, context?.versions?.[library]);
  const checks = [{
    id: `${library}-version`, title: `${library} version selects a contract set`, basis: 'absolute', applies,
    check(value, context) {
      const selection = pick(context);
      if (selection.state !== 'selected') return [open(library, selection, `The ${library} version cannot select a contract set. ${selection.diagnostic} No contract passes.`)];
      return [{ severity: 'info', message: `The ${library} ${selection.detection.version} contract set ${selection.set.major} applies.`, evidence: provenance(selection) }];
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
