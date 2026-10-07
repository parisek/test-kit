import { readFileSync } from 'node:fs';
import { adaptReport } from '../js/data.js';

export const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
export const sample = () => adaptReport(load('report.json'));
export const target = (report, id) => report.entries.find((entry) => entry.id === id);
