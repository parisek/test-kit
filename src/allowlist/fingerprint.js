// The fingerprint of an absolute finding (R9.8, ADR 0004, question 3).
// It hashes one finding of one run. It never hashes the run, the pair or the raw bytes of the artifact.
// The hash is `settingsHash` over a canonical descriptor: SHA-256 as `sha256:` and 64 lowercase hex digits.
import { settingsHash } from '../config/settings.js';

export const DESCRIPTOR_VERSION = 1;
export const MAX_DEPTH = 8;
export const MAX_CANONICAL_BYTES = 64 * 1024;

class Unfingerprintable extends Error {}
const refuse = (reason) => { throw new Unfingerprintable(reason); };

// Normalizes one value for the canonical form (rules 3 to 5 of the ADR). Key order is the job of `settingsHash`.
// `depth` is the nesting level below the descriptor. `path` holds the containers that enclose the value.
function normalize(value, depth, path) {
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'string') return value.normalize('NFC').replace(/\r\n?/g, '\n');
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) refuse('a number is not finite');
		return Object.is(value, -0) ? 0 : value;
	}
	if (value === undefined) refuse('a value is undefined');
	if (typeof value !== 'object') refuse(`a value is a ${typeof value}`);
	if (path.includes(value)) refuse('the evidence holds a cycle');
	if (depth > MAX_DEPTH) refuse(`the evidence is nested deeper than ${MAX_DEPTH} levels`);
	if (Array.isArray(value)) return value.map((item) => normalize(item, depth + 1, [...path, value]));
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) refuse('a value is not plain data');
	return Object.fromEntries(Object.keys(value).map((key) => [key, normalize(value[key], depth + 1, [...path, value])]));
}

// The descriptor with a fixed set of keys. Throws Unfingerprintable for a value that cannot be hashed.
function descriptorOf(item, occurrence) {
	const descriptor = {
		v: DESCRIPTOR_VERSION, kind: 'absolute-finding', checkId: item.checkId, targetId: item.targetId, viewportId: item.viewportId ?? null,
		artifact: item.artifact, message: item.message, evidence: item.evidence ?? {}, occurrence,
	};
	for (const key of ['checkId', 'targetId', 'artifact', 'message']) if (typeof descriptor[key] !== 'string') refuse(`${key} is not text`);
	if (descriptor.viewportId !== null && typeof descriptor.viewportId !== 'string') refuse('viewportId is not text');
	if (descriptor.evidence === null || typeof descriptor.evidence !== 'object' || Array.isArray(descriptor.evidence)) refuse('the evidence is not an object');
	const normalized = normalize(descriptor, 0, []);
	if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_CANONICAL_BYTES) refuse('the canonical form is larger than 64 KB');
	return normalized;
}

// One result for each item, in the order of the items. An item holds `checkId`, `targetId`, `viewportId`, `artifact`, `message` and `evidence`.
// A 1-based `occurrence` separates findings that have the same descriptor, in the order of the check output (the order of `items`).
// A result is `{ evidenceFingerprint }`, or `{ diagnostic }` when the evidence cannot be hashed. The finding then stays unexplained.
// An item that is `null` (a relative finding) gets `{}`: its fingerprint is the pair fingerprint of `evidence.js`.
export function absoluteFingerprints(items) {
	const counts = new Map();
	return items.map((item) => {
		if (item === null) return {};
		try {
			const key = settingsHash(descriptorOf(item, 1));
			const occurrence = (counts.get(key) ?? 0) + 1;
			counts.set(key, occurrence);
			return { evidenceFingerprint: occurrence === 1 ? key : settingsHash(descriptorOf(item, occurrence)) };
		} catch (error) {
			if (!(error instanceof Unfingerprintable)) throw error;
			return { diagnostic: `No evidence fingerprint: ${error.message}. The finding stays unexplained.` };
		}
	});
}
