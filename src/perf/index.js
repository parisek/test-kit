import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cpus, loadavg, platform } from 'node:os';
import { createRequire } from 'node:module';
import { performanceSettings, performanceProvenance, performanceConsent, machineLoad, summarizeSamples, extractMetrics, assertPerformanceNetwork } from './model.js';
import { startLocalProxy, resolveLocalAddress } from './proxy.js';
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

// The caller owns the immutable run directory and target selection.
export async function runPerformance({ targets, runDir, settings: options = {}, consent = false, allowHighLoad = false, chromePath } = {}) {
  const settings = performanceSettings(options);
  performanceConsent(targets?.length, settings, consent);
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
    await resolveLocalAddress(new URL(target.url));
  }
  const { lighthouse, version, launcher } = await tools();
  const proxy = await startLocalProxy();
  let chrome;
  const results = [];
  try {
    chrome = await launcher.launch({ ...(chromePath ? { chromePath } : {}), chromeFlags: ['--headless=new',
      '--disable-background-networking', '--disable-quic', '--disable-component-update', '--disable-sync',
      '--disable-extensions', '--no-first-run', '--disable-default-apps', '--disable-features=MediaRouter',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      `--proxy-server=http://127.0.0.1:${proxy.port}`, '--proxy-bypass-list=<-loopback>'] });
    const auditSettings = { ...settings };
    delete auditSettings.runs; delete auditSettings.warmup; delete auditSettings.networkPolicy;
    const flags = { ...auditSettings, port: chrome.port, output: ['json', 'html'], logLevel: 'error' };
    let browserVersion;
    for (const target of targets) {
      const samples = []; const paths = [];
      let suspect = initialLoad.suspect;
      const blockedBefore = proxy.blocked.length;
      try {
        const warmup = await lighthouse(target.url, flags);
        if (warmup?.lhr?.runtimeError) throw new Error('Performance warmup failed.');
        assertPerformanceNetwork(warmup.artifacts?.DevtoolsLog, proxy.blocked.slice(blockedBefore));
        browserVersion = warmup.lhr.environment?.hostUserAgent ?? 'unknown';
        const provenance = performanceProvenance(settings, version, browserVersion);
        for (let index = 0; index < settings.runs; index++) {
          const load = readLoad();
          suspect ||= load.suspect;
          const blockedStart = proxy.blocked.length;
          const measured = await lighthouse(target.url, flags);
          if (measured.lhr.environment?.hostUserAgent !== browserVersion) throw new Error('Browser identity changed during measurement.');
          assertPerformanceNetwork(measured.artifacts?.DevtoolsLog, proxy.blocked.slice(blockedStart));
          const base = `lighthouse/${target.id}/${index + 1}`;
          await mkdir(join(resolve(runDir), 'lighthouse', target.id), { recursive: true });
          const html = Array.isArray(measured.report) ? measured.report[1] : undefined;
          if (typeof html !== 'string') throw new Error('Lighthouse HTML report is unavailable.');
          await writeFile(join(resolve(runDir), `${base}.json`), JSON.stringify(measured.lhr), { mode: 0o600 });
          await writeFile(join(resolve(runDir), `${base}.html`), html, { mode: 0o600 });
          paths.push({ json: `${base}.json`, html: `${base}.html` });
          samples.push(extractMetrics(measured.lhr));
        }
        results.push({ targetId: target.id, artifact: { kind: 'lighthouse', state: 'captured', ...provenance,
          settings, blockedBackgroundRequests: proxy.blocked.length - blockedBefore, metrics: summarizeSamples(samples, settings.runs), suspect, load: initialLoad, reports: paths } });
      } catch (error) {
        results.push({ targetId: target.id, artifact: { kind: 'lighthouse', state: 'failed',
          ...performanceProvenance(settings, version, browserVersion ?? 'unknown'), settings, reports: paths,
          error: { code: 'PERFORMANCE_FAILED', message: error.message } } });
      }
    }
    return { settings, cost: performanceConsent(targets.length, settings, true), results };
  } finally { try { if (chrome) await chrome.kill(); } finally { await proxy.close(); } }
}
