import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cpus, loadavg, platform } from 'node:os';
import { createRequire } from 'node:module';
import { performanceSettings, performanceProvenance, performanceConsent, machineLoad, summarizeSamples, extractMetrics } from './model.js';
import { reachableLocalAddress, localCertificateSpki } from './network.js';
import { hostResolverRules, blockedUrlPatterns, requestEvidence, mergeBlocked, finalOriginProblem } from './isolation.js';
export * from './model.js';

const require = createRequire(import.meta.url);

async function tools() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 19) throw new Error('Lighthouse 13.5 needs Node 22.19 or newer.');
  try {
    const module = await import('lighthouse');
    const version = JSON.parse(await readFile(require.resolve('lighthouse/package.json'), 'utf8')).version;
    const launcherPath = createRequire(require.resolve('lighthouse/package.json')).resolve('chrome-launcher');
    const launcher = await import(launcherPath);
    return { lighthouse: module.default, version, launcher };
  } catch { throw new Error('Install the optional lighthouse peer in the test-kit runtime.'); }
}

// One audit: the request policy holds, the page stays on its origin, the blocked requests are evidence (R6.16, R6.17).
function audited(result, network) {
  if (result?.lhr?.runtimeError) throw new Error(`Lighthouse failed: ${String(result.lhr.runtimeError.code ?? 'runtime error').slice(0, 80)}.`);
  // Every group of the audit: the 50-group cap applies once, to the sum of the measured audits (R6.17).
  const evidence = requestEvidence(result?.artifacts?.DevtoolsLog, { ...network, limit: Infinity });
  if (evidence.violation) throw new Error(`The page broke the speed request policy: ${evidence.violation}.`);
  const moved = finalOriginProblem(result.lhr, network.origin);
  if (moved) throw new Error(moved);
  return evidence;
}

// The caller owns the immutable run directory and target selection.
// `network` names the side: its origin, `remote`, `allowOrigins` (origin strings), `blockPaths`,
// `userAgent` and `challenge`. Without it, the origin of the targets is a local side with no extra origin.
export async function runPerformance({ targets, runDir, settings: options = {}, consent = false, allowHighLoad = false, chromePath, network: side } = {}) {
  if (!Array.isArray(targets) || !targets.length) throw new Error('Performance needs at least one target.');
  const network = { origin: new URL(side?.origin ?? targets[0].url).origin, remote: side?.remote === true,
    allowOrigins: side?.allowOrigins ?? [], blockPaths: side?.blockPaths ?? [], challenge: side?.challenge ?? null, userAgent: side?.userAgent };
  const settings = performanceSettings({ ...options, network: { allowOrigins: network.allowOrigins, blockPaths: network.blockPaths } });
  performanceConsent(targets.length, settings, consent);
  const readLoad = () => {
    if (platform() === 'win32') {
      if (!allowHighLoad) throw new Error('Machine load is unavailable on Windows. Use an explicit suspect-run override.');
      return { load: null, cpuCount: cpus().length, suspect: true, reason: 'load-unavailable' };
    }
    return machineLoad(loadavg()[0], cpus().length, allowHighLoad);
  };
  const initialLoad = readLoad();
  if (new Set(targets.map(target => target.id)).size !== targets.length) throw new Error('Performance target IDs must be unique.');
  for (const target of targets) {
    if (!/^[a-zA-Z0-9_-]+$/.test(target.id)) throw new Error('Invalid performance target ID.');
    if (new URL(target.url).origin !== network.origin) throw new Error('Every performance target must use the origin of the side.');
  }
  const origin = new URL(network.origin);
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Performance accepts an HTTP or HTTPS origin only.');
  // A local side resolves to loopback once, and Chrome keeps that address. Its own certificate is the one exception to certificate checks.
  const address = network.remote ? null : await reachableLocalAddress(origin);
  const spki = !network.remote && origin.protocol === 'https:' ? await localCertificateSpki(origin, address) : null;
  const { lighthouse, version, launcher } = await tools();
  let chrome;
  const results = [];
  try {
    chrome = await launcher.launch({ ...(chromePath ? { chromePath } : {}), chromeFlags: ['--headless=new',
      '--disable-background-networking', '--disable-quic', '--disable-component-update', '--disable-sync',
      '--disable-extensions', '--no-first-run', '--disable-default-apps', '--disable-features=MediaRouter',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--no-proxy-server',
      `--host-resolver-rules=${hostResolverRules({ origin: network.origin, address, allowOrigins: network.allowOrigins })}`,
      ...(spki ? [`--ignore-certificate-errors-spki-list=${spki}`] : [])] });
    const auditSettings = { ...settings };
    delete auditSettings.runs; delete auditSettings.warmup; delete auditSettings.networkPolicy;
    // R3.4: the User-Agent of a remote side. It stays out of the settings hash.
    const flags = { ...auditSettings, ...(network.userAgent ? { emulatedUserAgent: network.userAgent } : {}),
      blockedUrlPatterns: blockedUrlPatterns(network.origin, network.blockPaths), port: chrome.port, output: ['json', 'html'], logLevel: 'error' };
    let browserVersion;
    let stopped = false;
    for (const target of targets) {
      // R6.16: on a remote side, one failed target stops the run. Later targets send no request.
      if (stopped) {
        results.push({ targetId: target.id, artifact: { kind: 'lighthouse', state: 'failed',
          ...performanceProvenance(settings, version, browserVersion ?? 'unknown'), settings, reports: [],
          error: { code: 'RUN_STOPPED', message: 'An earlier target of this remote side failed. The run stopped.' } } });
        continue;
      }
      const samples = []; const paths = [];
      let suspect = initialLoad.suspect;
      let blocked = []; let omitted = 0;
      try {
        const warmup = await lighthouse(target.url, flags);
        audited(warmup, network);
        browserVersion = warmup.lhr.environment?.hostUserAgent ?? 'unknown';
        const provenance = performanceProvenance(settings, version, browserVersion);
        for (let index = 0; index < settings.runs; index++) {
          const load = readLoad();
          suspect ||= load.suspect;
          const measured = await lighthouse(target.url, flags);
          if (measured?.lhr?.environment?.hostUserAgent !== browserVersion) throw new Error('Browser identity changed during measurement.');
          const evidence = audited(measured, network);
          blocked = mergeBlocked(blocked, evidence.blocked);
          omitted += evidence.omitted;
          const base = `lighthouse/${target.id}/${index + 1}`;
          await mkdir(join(resolve(runDir), 'lighthouse', target.id), { recursive: true });
          const html = Array.isArray(measured.report) ? measured.report[1] : undefined;
          if (typeof html !== 'string') throw new Error('Lighthouse HTML report is unavailable.');
          await writeFile(join(resolve(runDir), `${base}.json`), JSON.stringify(measured.lhr), { mode: 0o600 });
          await writeFile(join(resolve(runDir), `${base}.html`), html, { mode: 0o600 });
          paths.push({ json: `${base}.json`, html: `${base}.html` });
          samples.push(extractMetrics(measured.lhr));
        }
        // R6.17: the blocked requests of the measured audits, summed. At most 50 groups.
        omitted += blocked.slice(50).reduce((sum, group) => sum + group.count, 0);
        results.push({ targetId: target.id, artifact: { kind: 'lighthouse', state: 'captured', ...provenance,
          settings, metrics: summarizeSamples(samples, settings.runs), suspect, load: initialLoad, reports: paths,
          ...(blocked.length ? { blocked: blocked.slice(0, 50) } : {}), ...(omitted ? { blockedOmitted: omitted } : {}) } });
      } catch (error) {
        results.push({ targetId: target.id, artifact: { kind: 'lighthouse', state: 'failed',
          ...performanceProvenance(settings, version, browserVersion ?? 'unknown'), settings, reports: paths,
          error: { code: 'PERFORMANCE_FAILED', message: error.message } } });
        stopped = network.remote;
      }
    }
    return { settings, cost: performanceConsent(targets.length, settings, true), results };
  } finally { if (chrome) await chrome.kill(); }
}
