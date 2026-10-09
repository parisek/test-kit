// Read-only checks for the proposed local development loop.
import { spawnSync } from 'node:child_process';

const checks = [
	['node', process.execPath, ['--version']],
	['git', 'git', ['--version']],
	['github', 'gh', ['api', 'user', '--jq', '.login']],
	['ddev', 'ddev', ['--version']],
	['docker', 'docker', ['info', '--format', '{{.ServerVersion}}']],
	['codex', 'codex', ['--version']],
	['claude', 'claude', ['--version']],
];
const results = checks.map(([id, command, args]) => {
	const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
	if (id === 'node' && Number(process.versions.node.split('.')[0]) < 20) {
		return { id, ok: false, exitCode: 1, detail: 'Node 20 or newer is required.' };
	}
	return { id, ok: result.status === 0, exitCode: result.status,
		detail: (result.error?.message ?? (result.status === 0 ? result.stdout : result.stderr)).trim().slice(0, 600) };
});
console.log(JSON.stringify({ checks: results, note: 'CLI presence does not prove model access or CMS readiness.' }, null, 2));
process.exitCode = results.some(({ id, ok }) => ['node', 'git', 'github', 'ddev', 'docker'].includes(id) && !ok) ? 1 : 0;
