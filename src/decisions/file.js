// Reads and writes `test-kit.decisions.json` (R9.14). The only module of the area that touches the file system.
// It follows the file discipline of the allowlist (src/allowlist/file.js): no config key, a flag overrides the path,
// a missing file is empty, an invalid file fails, and a write goes through a temporary file and a rename.
import { open, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { DECISIONS_FILE, MAX_FILE_BYTES, normalizeDecisions, parseDecisions, decisionKey } from './model.js';
import { checkFingerprints } from './fingerprint.js';

// The path of the decisions file: the `--decisions` value, else the file beside the config. There is no config key.
export function decisionsPath({ configPath = 'test-kit.config.json', override } = {}) {
	return override !== undefined ? resolve(override) : join(dirname(resolve(configPath)), DECISIONS_FILE);
}

// Returns the bytes of the file, or null when the file does not exist. A directory, a device or a file over 1 MB is an error.
async function readBytes(file) {
	let handle;
	try { handle = await open(file, 'r'); } catch (error) {
		if (error.code === 'ENOENT') return null;
		throw error;
	}
	try {
		const info = await handle.stat();
		if (!info.isFile()) throw new Error('Invalid decisions: the path is not a file.');
		if (info.size > MAX_FILE_BYTES) throw new Error('Invalid decisions: the file is larger than 1 MB.');
		const bytes = Buffer.alloc(info.size + 1);
		let length = 0;
		while (length < bytes.length) {
			const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
			if (!bytesRead) break;
			length += bytesRead;
		}
		if (length > info.size) throw new Error('Invalid decisions: the file changed during reading.');
		return bytes.subarray(0, length);
	} finally { await handle.close(); }
}

// A missing file is an empty list. An invalid file throws: it never falls back to an empty list.
export async function readDecisions(file) {
	const bytes = await readBytes(file);
	return { entries: bytes === null ? [] : checkFingerprints(parseDecisions(bytes).entries), bytes };
}

// The file must be unchanged since it was read. A file that did not exist must still not exist.
async function commitDecisions(file, original, updated) {
	const temporary = `${file}.test-kit-${process.pid}-${Date.now()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
		const current = await readBytes(file);
		const same = original === null ? current === null : current !== null && current.equals(original);
		if (!same) throw new Error('The decisions file changed during recording. No update is written.');
		await rename(temporary, file);
	} finally { await unlink(temporary).catch(() => {}); }
}

// Adds one entry. It never edits or removes an entry. It refuses a second entry for the same difference and the same
// design value. An entry for the same difference and another design value is a new decision: the old one goes stale.
export async function appendDecision(file, entry) {
	const { entries, bytes } = await readDecisions(file);
	if (entries.some((item) => decisionKey(item) === decisionKey(entry) && item.fingerprint === entry.fingerprint)) {
		throw new Error('This difference already has a decision for this design value. Edit test-kit.decisions.json by hand to change it.');
	}
	const updated = normalizeDecisions({ schemaVersion: 1, entries: [...entries, entry] });
	await commitDecisions(file, bytes, updated);
	return updated.entries.length;
}
