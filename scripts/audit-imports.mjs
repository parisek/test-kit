#!/usr/bin/env node
// Read a static theme without importing or executing its modules.
import { readFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(process.argv[2] ?? '.');
const tracked = execFileSync('git', ['ls-files', '-z', '--', 'tests'], { cwd: root, encoding: 'utf8' });
const files = tracked.split('\0').filter(Boolean).map(path => resolve(root, path));
const modules = files.filter(path => /\.(?:js|mjs|cjs)$/.test(path));
const edges = [];
for (const path of modules) {
  const source = await readFile(path, 'utf8');
  // This lexical inventory covers the one-line imports in the source snapshot.
  // It is not a parser. Review computed and multiline imports separately.
  const pattern = /^(?:[ \t]*import\b[^\n]*?\bfrom\s*|[ \t]*import\s*\(|[ \t]*(?:const|let|var)\b[^\n]*?\brequire\s*\(|[ \t]*require\s*\()\s*['"]([^'"\n]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    const destination = name.startsWith('.') ? relative(root, resolve(dirname(path), name))
      : name.startsWith('#tests/') ? `tests/lib/${name.slice(7)}` : name;
    edges.push({ from: relative(root, path), to: destination });
  }
}
const areas = ['visual', 'lib', 'behavior', 'eslint', 'stylelint'];
const counts = Object.fromEntries(areas.map(area => [area,
  files.filter(path => relative(root, path).startsWith(`tests/${area}/`)).length]));
const libraryConsumers = edges.filter(edge => edge.to.startsWith('tests/lib/')
  && !edge.from.startsWith('tests/lib/'));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const scripts = Object.fromEntries(Object.entries(pkg.scripts ?? {})
  .filter(([name]) => /^(?:visual:|behavior:|test:|lint:)/.test(name)));
console.log(JSON.stringify({ counts, scripts, libraryConsumers, edges }, null, 2));
