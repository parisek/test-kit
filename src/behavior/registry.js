import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectContracts, validateContracts } from './contracts.js';
export async function loadProjectContracts(directory) {
  let files;
  try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const contracts = [];
  for (const file of files.filter(name => name.endsWith('.contract.js')).sort()) {
    contracts.push(...collectContracts(await import(pathToFileURL(resolve(directory, file)).href)));
  }
  return validateContracts(contracts);
}
