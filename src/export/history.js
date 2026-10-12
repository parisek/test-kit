import { lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { historyEvidencePath, loadHistoryEvidence, renderHistory, renderRunFeedback, scanHistory } from '../history/index.js';
import { exportReport } from './report.js';

/** Export a snapshot of local history. Source evidence is not changed. */
export async function exportHistory({ local, outputDir } = {}) {
  if (typeof local !== 'string' || !local || typeof outputDir !== 'string' || !outputDir) throw new Error('History export needs local and output directories.');
  const outputPath = resolve(outputDir);
  const store = await realpath(local);
  const suffix = relative(store, outputPath);
  if (suffix === '' || (suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix))) throw new Error('History export must stay outside its source store.');
  try { await lstat(outputPath); throw new Error('Export output already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(outputPath), { recursive: true });
  const stage = await mkdtemp(join(dirname(outputPath), `.${basename(outputPath)}-`));
  let reserved = false;
  try {
    const stageRelative = relative(store, await realpath(stage));
    if (stageRelative === '' || (stageRelative !== '..' && !stageRelative.startsWith('../') && !isAbsolute(stageRelative))) throw new Error('History export must stay outside its source store.');
    const history = await scanHistory(store);
    await mkdir(join(stage, 'runs'));
    await mkdir(join(stage, 'reports'));
    let runCount = 0;
    let reportCount = 0;
    for (const entry of history.runs) {
      if (!entry.value) continue;
      let feedback;
      try { feedback = await loadHistoryEvidence(store, 'runs', entry.id, 'feedback.json'); } catch {}
      await mkdir(join(stage, 'runs', entry.id));
      await writeFile(join(stage, 'runs', entry.id, 'index.html'), renderRunFeedback({ id: entry.id, run: entry.value, feedback }, { historyUrl: '../../index.html' }));
      runCount += 1;
    }
    for (const entry of history.reports) {
      if (!entry.value) continue;
      const reportPath = await historyEvidencePath(store, 'reports', entry.id, 'report.json');
      await exportReport({ reportPath, outputDir: join(stage, 'reports', entry.id) });
      reportCount += 1;
    }
    await writeFile(join(stage, 'index.html'), renderHistory(history, {
      staticExport: true,
      runUrl: id => `runs/${encodeURIComponent(id)}/index.html`,
      reportUrl: id => `reports/${encodeURIComponent(id)}/index.html`,
    }));
    // Reserve the destination without replacing an existing directory.
    await mkdir(outputPath);
    reserved = true;
    await rename(stage, outputPath);
    reserved = false;
    return { outputPath, count: reportCount, reportCount, runCount };
  } catch (error) {
    if (reserved) await rm(outputPath, { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
