#!/usr/bin/env node
// Check a review record file: node scripts/milestone/check-record.js <file> [--sha <head SHA>] [--spec <path>]
import { readFileSync } from 'node:fs';
import { parseRecord, validateRecord, approvalBlockers, requirementIdsFrom } from './records.js';

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const file = args.find((value, at) => !value.startsWith('--') && !['--sha', '--spec'].includes(args[at - 1]));
if (!file) { console.error('Usage: check-record.js <file> [--sha <head SHA>] [--spec <path>]'); process.exit(2); }

const parsed = parseRecord(readFileSync(file, 'utf8'));
if (!parsed.ok) { console.error(parsed.errors.join('\n')); process.exit(1); }
const spec = readFileSync(option('--spec') ?? 'docs/specification.md', 'utf8');
const result = validateRecord(parsed.record, { headSha: option('--sha'), requirementIds: requirementIdsFrom(spec) });
if (!result.ok) { console.error(result.errors.join('\n')); process.exit(1); }
const blockers = approvalBlockers(parsed.record);
console.log(blockers.length ? `Valid record. Not an approval: ${blockers.join(' ')}` : 'Valid record. Counts as an approval.');
