#!/usr/bin/env node
// Check a review record file.
// Usage: check-record.mjs <file> [--sha <head SHA>] [--spec <file>]... [--pattern <regex>]
// Without --spec, no identifier is checked against a source. Write the base branch's source to a file first
// (git show origin/main:docs/specification.md > base-spec.md), so a change cannot add its own identifier.
// Exit: 0 valid (prints whether it counts as an approval), 1 invalid, 2 usage.
import { readFileSync } from 'node:fs';
import { parseRecord, validateRecord, approvalBlockers, requirementIdsFrom, DEFAULT_REQUIREMENT_PATTERN } from './records.mjs';

const args = process.argv.slice(2);
const valueOptions = ['--sha', '--spec', '--pattern'];
const all = (name) => args.flatMap((value, at) => (value === name && at + 1 < args.length ? [args[at + 1]] : []));
const file = args.find((value, at) => !value.startsWith('--') && !valueOptions.includes(args[at - 1]));
if (!file) { console.error('Usage: check-record.mjs <file> [--sha <head SHA>] [--spec <file>]... [--pattern <regex>]'); process.exit(2); }

const parsed = parseRecord(readFileSync(file, 'utf8'));
if (!parsed.ok) { console.error(parsed.errors.join('\n')); process.exit(1); }
const specs = all('--spec');
const custom = all('--pattern')[0];
const pattern = custom ?? DEFAULT_REQUIREMENT_PATTERN;
const requirementIds = specs.length ? requirementIdsFrom(specs.map((path) => readFileSync(path, 'utf8')).join('\n'), pattern) : undefined;
const result = validateRecord(parsed.record, { headSha: all('--sha')[0], requirementIds, ...(custom ? { idFormat: null } : {}) });
if (!result.ok) { console.error(result.errors.join('\n')); process.exit(1); }
const blockers = approvalBlockers(parsed.record);
console.log(blockers.length ? `Valid record. Not an approval: ${blockers.join(' ')}` : 'Valid record. Counts as an approval.');
