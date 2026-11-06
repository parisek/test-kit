import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function gitSha(directory) {
  try {
    const { stdout } = await execute('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: directory, timeout: 10000 });
    const sha = stdout.trim();
    if (/^[a-f0-9]{7,40}$/.test(sha)) return sha;
  } catch { /* A configuration can live outside a Git repository. */ }
  return '0000000';
}
