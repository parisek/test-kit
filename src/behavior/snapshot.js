import { createHash } from 'node:crypto';
import { relativePath } from '../report/safe.js';
import { BEHAVIOR_ORIGINS } from '../report/catalog.js';
const CONTRACT_NAME = /^[a-z0-9][a-z0-9-]{0,79}$/;
export function validateBehaviorSnapshot(value) {
  if (!value || value.tool !== 'test-kit-behavior' || typeof value.version !== 'string' || !/^[a-f0-9]{64}$/.test(value.settingsHash) || !['complete', 'failed', 'missing'].includes(value.state) || !Array.isArray(value.steps) || value.steps.length > 3000) throw new Error('Invalid behavior snapshot.');
  if (!value.settings || typeof value.settings !== 'object' || createHash('sha256').update(JSON.stringify(value.settings)).digest('hex') !== value.settingsHash) throw new Error('Behavior settings hash differs.');
  // Version 1 steps carry no contract name. A newer snapshot names the contract of every step (ADR 0004, question 1).
  const legacy = value.version === '1';
  const names = new Set();
  if (!legacy) {
    if (!Array.isArray(value.settings.contracts)) throw new Error('Behavior settings need their contracts.');
    for (const contract of value.settings.contracts) {
      if (!contract || typeof contract.name !== 'string' || !CONTRACT_NAME.test(contract.name) || !BEHAVIOR_ORIGINS.includes(contract.origin)) throw new Error('Invalid behavior contract settings.');
      names.add(contract.name);
    }
  }
  const ids = new Set();
  for (const step of value.steps) {
    if (!step || typeof step.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(step.id) || ids.has(step.id) || typeof step.title !== 'string' || step.title.length > 2000 || !['complete', 'failed', 'skipped', 'incompatible'].includes(step.state)) throw new Error('Invalid behavior step.');
    if (!legacy && (typeof step.contract !== 'string' || !names.has(step.contract))) throw new Error('A behavior step names a contract that its settings list.');
    ids.add(step.id);
    if (step.evidence?.screenshot != null && (!relativePath(step.evidence.screenshot) || !step.evidence.screenshot.endsWith('.png'))) throw new Error('Unsafe behavior screenshot.');
  }
  const expectedState = value.steps.some(step => ['failed', 'incompatible'].includes(step.state)) ? 'failed' : value.steps.some(step => step.state === 'complete' && !step.id.endsWith('-detect')) ? 'complete' : 'missing';
  if (value.state !== expectedState) throw new Error('Behavior state differs from its steps.');
  if (value.trace != null && (!relativePath(value.trace) || !value.trace.endsWith('.zip'))) throw new Error('Unsafe behavior trace.');
  return value;
}
