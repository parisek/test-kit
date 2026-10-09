export function isLocalUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname;
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]'
    || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) || host.endsWith('.ddev.site');
}

export function createRunId(date, pid, sha) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || !Number.isInteger(pid) || pid < 1 || !/^[a-f0-9]{7,40}$/.test(sha)) throw new Error('Invalid run identity');
  return `${date.toISOString().replace(/[:.]/g, '-')}-${pid}-${sha}`;
}

export function assertImageBounds(width, height, deviceScaleFactor = 1) {
  if (![width, height, deviceScaleFactor].every(value => Number.isFinite(value) && value > 0)
    || height > 30000 || Math.ceil(width * deviceScaleFactor) * Math.ceil(height * deviceScaleFactor) > 40_000_000) {
    throw new Error('Screenshot exceeds the height or pixel limit');
  }
}

export function targetPath(target, side) {
  return target.paths && Object.hasOwn(target.paths, side) ? target.paths[side] : target.path;
}
