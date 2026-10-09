export function artifactState(a, b) {
  if (!a || !b) return 'missing';
  if (a.state !== 'captured' || b.state !== 'captured') return 'failed';
  if (!['tool', 'version', 'settingsHash', 'browserVersion'].every(key => typeof a[key] === 'string' && a[key].length > 0 && a[key].length <= 200)
    || a.tool !== b.tool || a.version !== b.version || a.settingsHash !== b.settingsHash
    || a.browserVersion !== b.browserVersion) return 'incompatible';
  return 'complete';
}

