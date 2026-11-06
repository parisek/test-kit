// Pure guards for the Figma provider (R5.5, R4.4). The file key, the node IDs and the image URLs are untrusted
// text: they come from the configuration or from an API response. No network and no file system here.
export const FIGMA_API_BASE = 'https://api.figma.com';
export const FIGMA_TOKEN_ENV = 'FIGMA_TOKEN';
export const MAX_NODE_ID = 100;

// A Figma file key (or branch key) is a short run of letters and digits.
export function fileKeyProblem(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{8,64}$/.test(value)) return 'must be a Figma file key (8 to 64 letters and digits)';
  return null;
}

// A node ID is `12:34`. An instance child is `I12:34;56:78`. The URL form `12-34` is not accepted.
// The strict set keeps `,`, `&`, `=`, `/`, `?`, `#`, `%` and white space out of the request.
const NODE_PART = '[A-Za-z0-9]+(?::[A-Za-z0-9]+)+';
const NODE_ID = new RegExp(`^${NODE_PART}(?:;${NODE_PART})*$`);
export function nodeIdProblem(value) {
  if (typeof value !== 'string' || !value.length || value.length > MAX_NODE_ID || !NODE_ID.test(value)) return 'must be a Figma node ID such as "12:34" (not "12-34")';
  return null;
}

// The `scale` of an export. It is the device scale of the viewport, so the image is viewport width x scale wide (R8.15).
// The tool never resizes a design image. The API accepts 0.01 to 4. A viewport allows 0.5 to 3.
export function figmaScale(viewport) {
  const scale = viewport.deviceScaleFactor ?? 1;
  if (!(scale >= 0.01 && scale <= 4)) throw new Error(`Viewport ${viewport.id} has a device scale that Figma cannot export.`);
  return scale;
}

// Image storage hosts. The API response names the URL, but the response is data from the network, so the host is checked
// against a fixed list instead of trusting it. The list is the Figma S3 buckets and Figma's own hosts.
const IMAGE_HOSTS = [/^figma-[a-z0-9-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/, /^(?:[a-z0-9-]+\.)*figma\.com$/];

// The reason an image URL is refused, or null. It names no part of the URL, because the URL is signed.
export function imageUrlProblem(value) {
  if (typeof value !== 'string' || value.length > 4096) return 'is not a URL';
  let url;
  try { url = new URL(value); } catch { return 'is not a URL'; }
  if (url.protocol !== 'https:') return 'is not https';
  if (url.username || url.password) return 'holds credentials';
  if (url.port) return 'names a port';
  if (!IMAGE_HOSTS.some(pattern => pattern.test(url.hostname))) return 'is not on a Figma image host';
  return null;
}

// The token is sent in a header, so it must be one line of visible ASCII. The problem text never holds the token.
export function tokenProblem(value) {
  if (typeof value !== 'string' || !value.length) return 'is empty';
  if (!/^[\x21-\x7e]{1,512}$/.test(value)) return 'has an invalid form (one line of visible ASCII, at most 512 characters)';
  return null;
}
