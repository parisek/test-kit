// R11.10, #149: the evidence of one finding as a directory for a task. Owner decision on #149
// (2026-10-22): the bundle is tool-neutral, one directory per finding, and the package uploads nothing.
// A person or an agent attaches the files through the task tool.
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { adaptReport } from '../report/model.js';
import { readSidecar } from '../artifacts/compare.js';
import { findingIsExplained } from '../report/classify.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
export const CROP_MARGIN = 24;
export const CROP_LIMIT = 2400;
export const REGION_LIMIT = 50;
const PIXEL_LIMIT = 40_000_000;
const TEXT_LIMIT = 500;

const whole = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
// C0 and C1 control characters and the Unicode direction controls become spaces, so a value cannot
// reorder the text around it.
const text = (value, max = TEXT_LIMIT) => (typeof value === 'string' ? value : '').replace(/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ').slice(0, max);

// The regions of a diff that are whole numbers inside the canvas. Report data is untrusted.
export function validRegions(regions, canvas) {
  if (!Array.isArray(regions)) return [];
  return regions.slice(0, 10_000).filter(region => region && whole(region.x, canvas.width) && whole(region.y, canvas.height)
    && whole(region.width, canvas.width) && whole(region.height, canvas.height) && region.width > 0 && region.height > 0
    && region.x + region.width <= canvas.width && region.y + region.height <= canvas.height)
    .map(({ x, y, width, height, pixels }) => ({ x, y, width, height, ...(whole(pixels, PIXEL_LIMIT) ? { pixels } : {}) }));
}

// The crop of a screenshot finding: the union of its regions plus a margin, inside the canvas.
// Without a region it is the whole canvas. A crop is at most CROP_LIMIT px on each axis; a larger
// one keeps its top-left corner and sets `truncated`. Pure (R4.4).
export function cropBox(regions, canvas) {
  let box;
  if (!regions.length) box = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  else {
    const left = Math.max(0, Math.min(...regions.map(r => r.x)) - CROP_MARGIN);
    const top = Math.max(0, Math.min(...regions.map(r => r.y)) - CROP_MARGIN);
    const right = Math.min(canvas.width, Math.max(...regions.map(r => r.x + r.width)) + CROP_MARGIN);
    const bottom = Math.min(canvas.height, Math.max(...regions.map(r => r.y + r.height)) + CROP_MARGIN);
    box = { x: left, y: top, width: right - left, height: bottom - top };
  }
  const truncated = box.width > CROP_LIMIT || box.height > CROP_LIMIT;
  return { ...box, width: Math.min(box.width, CROP_LIMIT), height: Math.min(box.height, CROP_LIMIT), ...(truncated ? { truncated: true } : {}) };
}

// Text for a Markdown task. A value from the report is plain text: control characters become
// spaces, and Markdown punctuation is escaped. "." , ":" and "@" are escaped too, so a bare URL, a
// `www.` name or an e-mail address is not an autolink of GitHub-flavored Markdown.
export function markdownText(value, max = TEXT_LIMIT) {
  return text(value, max).replace(/[\\`*_{}\[\]()<>#+!|~.:@-]/g, character => `\\${character}`);
}

export function bundleMarkdown(record) {
  const { finding, report, crop, regions, regionsOmitted, images } = record;
  const lines = [`# ${markdownText(finding.message) || 'Finding'}`, ''];
  lines.push(`- Target: ${markdownText(finding.targetId)}`);
  if (finding.viewportId != null) lines.push(`- Viewport: ${markdownText(finding.viewportId)}`);
  lines.push(`- Artifact: ${markdownText(finding.artifact)}${finding.checkId ? ` (check ${markdownText(finding.checkId)})` : ''}`);
  lines.push(`- Class: ${finding.class}`);
  if (report.pair) lines.push(`- Pair: ${markdownText(report.pair.kind)}, run A ${markdownText(report.pair.aRunId)}, run B ${markdownText(report.pair.bRunId)}`);
  if (report.subject) lines.push(`- Run: ${markdownText(report.subject.runId)}`);
  lines.push(`- Finding: ${markdownText(finding.id)}`);
  if (images.a) {
    lines.push('', '## Images', '', `- ${images.a}: side A`, `- ${images.b}: side B`, `- ${images.diff}: the difference`);
    lines.push(`- Crop: x ${crop.x}, y ${crop.y}, ${crop.width} × ${crop.height} px of the full screenshot${crop.truncated ? ' (cut at the size limit)' : ''}`);
    lines.push(`- Regions: ${regions.length} in finding.json${regionsOmitted ? `, ${regionsOmitted} more not listed` : ''}${record.regionsInvalid ? `, ${record.regionsInvalid} invalid in the report` : ''}`);
  }
  lines.push('', 'The tool wrote this text from the report. The images are evidence, not a verdict.', '');
  return lines.join('\n');
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// The size of a PNG from its chunks, before a decoder allocates memory. The first chunk must be IHDR,
// and no later chunk may be IHDR: a decoder can take its size from a second header. Pure (R4.4).
export function pngPixels(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('The image is not a PNG.');
  let pixels = null;
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8);
    if (pixels === null && (type !== 'IHDR' || length !== 13)) throw new Error('The PNG does not start with one IHDR chunk.');
    if (type === 'IHDR' && pixels !== null) throw new Error('The PNG has more than one IHDR chunk.');
    if (type === 'IHDR') pixels = bytes.readUInt32BE(at + 8) * bytes.readUInt32BE(at + 12);
    if (type === 'IEND') break;
    at += 12 + length;
  }
  return pixels;
}

function decode(PNG, bytes) {
  if (pngPixels(bytes) > PIXEL_LIMIT) throw new Error('PNG exceeds the pixel limit.');
  const image = PNG.sync.read(bytes);
  if (image.width * image.height > PIXEL_LIMIT) throw new Error('PNG exceeds the pixel limit.');
  return image;
}

// Copies the crop of one image to a new PNG. A side smaller than the crop is padded with white,
// as the comparison pads it (R8.18). The source is the full-resolution original (R11.3).
export function cropImage(PNG, image, box) {
  const out = new PNG({ width: box.width, height: box.height });
  out.data.fill(255);
  const width = Math.max(0, Math.min(box.width, image.width - box.x));
  const height = Math.max(0, Math.min(box.height, image.height - box.y));
  if (width > 0 && height > 0) PNG.bitblt(image, out, box.x, box.y, width, height, 0, 0);
  return PNG.sync.write(out);
}

async function readReport(reportPath) {
  const path = resolve(reportPath), root = dirname(path);
  return { path, root, report: adaptReport(JSON.parse(await readSidecar(root, basename(path), 16_000_000))) };
}

export const LIST_LIMIT = 100;
// Without --finding, `bundle` lists the findings of the report, so a person can pick an id. It writes nothing.
export async function listFindings({ reportPath }) {
  const { report } = await readReport(reportPath);
  const all = (report.findings ?? []).filter(item => typeof item?.id === 'string');
  return { findings: all.slice(0, LIST_LIMIT).map(item => ({ id: text(item.id, 200), targetId: text(item.targetId, 200), viewportId: item.viewportId == null ? null : text(item.viewportId, 200), artifact: text(item.artifact, 64),
    class: findingIsExplained(report, item) ? 'explained' : 'unexplained', ...(SAFE_ID.test(item.id) ? {} : { bundle: false }) })), findingsOmitted: Math.max(0, all.length - LIST_LIMIT) };
}

export async function writeBundle({ reportPath, findingId, output }) {
  if (typeof findingId !== 'string' || !SAFE_ID.test(findingId)) throw new Error('--finding must be the id of one finding: letters, digits, ".", "_" and "-", at most 200 characters.');
  const { path, root, report } = await readReport(reportPath);
  const finding = (report.findings ?? []).find(item => item?.id === findingId);
  if (!finding) throw new Error(`The report has no finding ${findingId}.`);
  const target = report.entries.find(entry => entry.id === finding.targetId);
  const row = target?.viewports.find(item => item.id === finding.viewportId);
  const record = {
    schemaVersion: 1,
    finding: { id: findingId, targetId: text(finding.targetId, 200), viewportId: finding.viewportId == null ? null : text(finding.viewportId, 200), artifact: text(finding.artifact, 64),
      ...(typeof finding.checkId === 'string' ? { checkId: text(finding.checkId, 200) } : {}), message: text(finding.message), class: findingIsExplained(report, finding) ? 'explained' : 'unexplained' },
    report: { file: basename(path), generated: typeof report.meta?.generated === 'string' ? text(report.meta.generated, 64) : null,
      ...(report.pair ? { pair: { kind: text(report.pair.kind, 64), aRunId: text(report.pair.aRunId, 200), bRunId: text(report.pair.bRunId, 200) } } : {}),
      ...(report.subject ? { subject: { runId: text(report.subject.runId, 200) } } : {}) },
    crop: null, regions: [], regionsOmitted: 0, regionsInvalid: 0, images: {},
  };
  const files = {};
  const shot = finding.artifact === 'screenshot' ? row?.artifacts?.screenshot : null;
  if (shot?.a?.src && shot?.b?.src && shot?.diff?.src) {
    // pngjs loads only here, so the pure helpers above run in `node --test` without a dependency (R4.4).
    const { PNG } = await import('pngjs');
    // The sources are paths inside the report folder. readSidecar refuses any other path.
    const [a, b, diff] = await Promise.all([shot.a.src, shot.b.src, shot.diff.src].map(async src => decode(PNG, await readSidecar(root, src, 256 * 1024 * 1024))));
    const canvas = { width: diff.width, height: diff.height };
    const regions = validRegions(shot.diff.regions, canvas);
    const given = Array.isArray(shot.diff.regions) ? Math.min(shot.diff.regions.length, 10_000) : 0;
    const crop = cropBox(regions, canvas);
    const inside = regions.filter(r => r.x < crop.x + crop.width && r.y < crop.y + crop.height && r.x + r.width > crop.x && r.y + r.height > crop.y);
    Object.assign(record, { crop, regions: inside.slice(0, REGION_LIMIT), regionsOmitted: regions.length - Math.min(inside.length, REGION_LIMIT), regionsInvalid: given - regions.length, images: { a: 'a.png', b: 'b.png', diff: 'diff.png' } });
    Object.assign(files, { 'a.png': cropImage(PNG, a, crop), 'b.png': cropImage(PNG, b, crop), 'diff.png': cropImage(PNG, diff, crop) });
  }
  files['finding.json'] = `${JSON.stringify(record, null, 2)}\n`;
  files['finding.md'] = bundleMarkdown(record);
  const dir = join(resolve(output), findingId);
  await mkdir(resolve(output), { recursive: true });
  // A bundle never replaces an earlier one: the directory must be new.
  try { await mkdir(dir); } catch (error) { if (error.code === 'EEXIST') throw new Error(`${dir} exists. Remove it or choose another --output.`); throw error; }
  const names = Object.keys(files).sort();
  for (const name of names) await writeFile(join(dir, name), files[name], { flag: 'wx', mode: 0o644 });
  return { bundle: dir, files: names };
}
