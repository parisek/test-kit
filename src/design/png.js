import { createHash } from 'node:crypto';
import { assertImageBounds } from '../capture/helpers.js';

const SIGNATURE = '89504e470d0a1a0a';
export const MAX_DESIGN_BYTES = 40 * 1024 * 1024;

// Width and height from the PNG header. No decode. Throws on a file that is not a PNG or exceeds the image limits.
export function readPngSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.toString('hex', 0, 8) !== SIGNATURE || bytes.toString('latin1', 12, 16) !== 'IHDR') throw new Error('A design image must be a PNG file.');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assertImageBounds(width, height);
  return { width, height };
}

// R8.15: the width a design image must have for a viewport is the viewport width times the device scale.
export function expectedWidth(viewport) {
  return Math.round(viewport.width * (viewport.deviceScaleFactor ?? 1));
}

// The diagnostic for a wrong width, or null. It names both sizes. It never crops or resizes (R8.15).
export function widthProblem(viewport, width) {
  const expected = expectedWidth(viewport);
  if (width === expected) return null;
  const scale = viewport.deviceScaleFactor ?? 1;
  return `Design image is ${width} px wide. Viewport ${viewport.id} needs ${expected} px (width ${viewport.width} x scale ${scale}).`;
}

// SHA-256 of the image bytes, as hex.
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Provenance of one imported image (R4.6). `importedAt` is an ISO string the caller supplies.
// `extra` holds the fields only one provider has: `fileKey` and `scale` for `figma`. It never holds a secret.
export function designProvenance({ source, importedAt, bytes, provider = 'files', extra = {} }) {
  const { width, height } = readPngSize(bytes);
  return { provider, source, ...extra, importedAt, sha256: sha256(bytes), width, height };
}
