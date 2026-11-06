// Reads and writes `test-kit.allowlist.json` (R9.12). The only module of the area that touches the file system.
import { open, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { ALLOWLIST_FILE, MAX_FILE_BYTES, normalizeAllowlist, parseAllowlist, tripleKey } from './model.js';

// The path of the allowlist: the `--allowlist` value, else the file beside the config. There is no config key.
export function allowlistPath({ configPath = 'test-kit.config.json', override } = {}) {
	return override !== undefined ? resolve(override) : join(dirname(resolve(configPath)), ALLOWLIST_FILE);
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
		if (!info.isFile()) throw new Error('Invalid allowlist: the path is not a file.');
		if (info.size > MAX_FILE_BYTES) throw new Error('Invalid allowlist: the file is larger than 1 MB.');
		const bytes = Buffer.alloc(info.size + 1);
		let length = 0;
		while (length < bytes.length) {
			const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
			if (!bytesRead) break;
			length += bytesRead;
		}
		if (length > info.size) throw new Error('Invalid allowlist: the file changed during reading.');
		return bytes.subarray(0, length);
	} finally { await handle.close(); }
}

// A missing file is an empty allowlist. An invalid file throws: it never falls back to an empty list (ADR 0004, question 4).
export async function readAllowlist(file) {
	const bytes = await readBytes(file);
	return { entries: bytes === null ? [] : parseAllowlist(bytes).entries, bytes };
}

// Writes the new file through a temporary file and a rename, as `commitConfig` does for the config.
// The file must be unchanged since it was read. A file that did not exist must still not exist.
async function commitAllowlist(file, original, updated) {
	const temporary = `${file}.test-kit-${process.pid}-${Date.now()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
		const current = await readBytes(file);
		const same = original === null ? current === null : current !== null && current.equals(original);
		if (!same) throw new Error('The allowlist changed during recording. No update is written.');
		await rename(temporary, file);
	} finally { await unlink(temporary).catch(() => {}); }
}

// Adds one entry. It never edits or removes an entry. It refuses a duplicate of the check, the target and the fingerprint.
export async function appendEntry(file, entry) {
	const { entries, bytes } = await readAllowlist(file);
	if (entries.some((item) => tripleKey(item) === tripleKey(entry))) throw new Error('This check, target and fingerprint are already allowlisted.');
	const updated = normalizeAllowlist({ schemaVersion: 1, entries: [...entries, entry] });
	await commitAllowlist(file, bytes, updated);
	return updated.entries.length;
}
