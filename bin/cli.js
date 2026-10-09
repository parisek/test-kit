#!/usr/bin/env node
import { run } from '../src/cli/run.js';
import { readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
process.exitCode = await run(process.argv.slice(2), { out: process.stdout, err: process.stderr }, version);
