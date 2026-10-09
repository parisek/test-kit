// The project contract seam matches the component contract registry (R13.41).
export const DEFAULT_PROJECTS = ['desktop-1280', 'mobile-390'];
export function collectContracts(module) {
  const isContract = value => value && typeof value.detect === 'function' && typeof value.run === 'function';
  return isContract(module) ? [module] : Object.values(module).filter(isContract);
}
export function validateContracts(contracts) {
  if (!Array.isArray(contracts) || contracts.length > 100) throw new Error('Use at most 100 behavior contracts.');
  const names = new Set();
  for (const contract of contracts) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(contract.name) || names.has(contract.name)) throw new Error('Behavior contract names must be unique plain identifiers.');
    names.add(contract.name);
    if (typeof contract.detect !== 'function' || typeof contract.run !== 'function') throw new Error('A contract must export detect and run.');
    if (contract.runScoping !== undefined && typeof contract.runScoping !== 'function') throw new Error('runScoping must be a function.');
    if (contract.projects !== undefined && (!Array.isArray(contract.projects) || !contract.projects.every(v => typeof v === 'string'))) throw new Error('Contract projects must be strings.');
  }
  return contracts;
}
export function contractApplicability(contract, { projectName, libraryVersions = {}, emulate = {}, eagerImages = false } = {}) {
  if (!(contract.projects ?? DEFAULT_PROJECTS).includes(projectName)) return { state: 'skipped', reason: 'Contract does not apply to this project.' };
  if (contract.library) {
    const version = libraryVersions[contract.library.package];
    const major = typeof version === 'string' && /^(\d+)\./.exec(version)?.[1];
    if (!major || !contract.library.majors?.includes(Number(major))) return { state: 'incompatible', reason: 'Contract library version is absent or unsupported.' };
  }
  if (contract.emulate && Object.entries(contract.emulate).some(([key, value]) => emulate[key] !== value)) return { state: 'incompatible', reason: 'Contract media settings must be applied before navigation.' };
  if (contract.eagerImages && !eagerImages) return { state: 'incompatible', reason: 'Contract requires eager images before navigation.' };
  return { state: 'ready' };
}
