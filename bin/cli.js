#!/usr/bin/env node
import { run } from '../src/cli/run.js';

process.exitCode = await run(process.argv.slice(2), { out: process.stdout, err: process.stderr });
