import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const contract = new URL('frontend/ui-contract/', root);
const provenance = JSON.parse(await readFile(new URL('provenance.json', contract)));
for (const [name, expected] of Object.entries(provenance.sha256)) {
	const actual = createHash('sha256')
		.update(await readFile(new URL(name, contract)))
		.digest('hex');
	if (actual !== expected) throw new Error(`UI contract changed: ${name}. Update its provenance.`);
}
const temp = await mkdtemp(join(tmpdir(), 'test-kit-viewer-build-'));
async function tree(directory, prefix = '') {
	const files = new Map();
	for (const item of await readdir(directory, { withFileTypes: true })) {
		const name = prefix + item.name;
		if (item.isDirectory())
			for (const [key, value] of await tree(join(directory, item.name), name + '/'))
				files.set(key, value);
		else files.set(name, await readFile(join(directory, item.name)));
	}
	return files;
}
try {
	const result = spawnSync('npm', ['--prefix', 'frontend', 'run', 'build'], {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, TEST_KIT_VIEWER_OUT: temp },
	});
	if (result.status !== 0) throw new Error('Viewer build failed.');
	const expected = await tree(fileURLToPath(new URL('viewer/', root)));
	const actual = await tree(temp);
	const routes = ['app.js', 'index.html', 'style.css'];
	if (actual.size !== routes.length || routes.some((name) => !actual.has(name)))
		throw new Error('The build must match the server asset allowlist.');
	if (
		expected.size !== actual.size ||
		[...actual].some(([name, bytes]) => !expected.get(name)?.equals(bytes))
	) {
		throw new Error('Committed viewer differs from its source. Run npm run build:viewer.');
	}
	console.log('Viewer build and UI contract hashes match.');
} finally {
	await rm(temp, { recursive: true, force: true });
}
