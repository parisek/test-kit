// The fingerprint of a decision (R9.14, #350 part C). It hashes the key of one layout difference and the design value
// at the time, so an entry binds to that value. A new design value gives another fingerprint, and the entry goes stale.
import { settingsHash } from '../config/settings.js';

export const DESCRIPTOR_VERSION = 1;

export function decisionFingerprint({ targetId, viewportId, part, property, designValue }) {
	return settingsHash({ v: DESCRIPTOR_VERSION, kind: 'layout-decision', targetId, viewportId, part, property, designValue });
}

// Each fingerprint must be the hash of its own key and design value. A hand edit of the value, the part or the
// property without a new fingerprint fails the file, so an entry cannot bind to a value it does not name.
export function checkFingerprints(entries) {
	entries.forEach((entry, index) => {
		if (decisionFingerprint(entry) !== entry.fingerprint) throw new Error(`Invalid decisions: entry ${index + 1}: fingerprint does not match the key and the design value.`);
	});
	return entries;
}
