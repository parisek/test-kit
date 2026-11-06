import { widthProblem } from './png.js';

// A run is a design run when its stored side has kind `design`. The stored settings decide, not the current config (R8.9).
export function isDesignRun(run) {
  return run?.settings?.sides?.[run.side]?.kind === 'design';
}

const sameViewport = (x, y) => Boolean(x && y) && x.width === y.width && (x.deviceScaleFactor ?? 1) === (y.deviceScaleFactor ?? 1);

// Why a design pair cell is `incompatible`, or null. Pure (R4.4). `a` and `b` are the captures of the cell.
// 1. Both runs need the viewport, with the same width and device scale.
// 2. A design image is as wide as its viewport times the device scale. No crop, no resize (R8.15).
export function designPairProblem(runA, runB, a, b) {
  const viewportOf = (run, capture) => run.settings.viewports.find(viewport => viewport.id === capture.viewportId);
  const va = viewportOf(runA, a);
  const vb = viewportOf(runB, b);
  if (!sameViewport(va, vb)) return `Viewport ${a.viewportId} differs between the runs (width or device scale).`;
  for (const [run, capture, viewport] of [[runA, a, va], [runB, b, vb]]) {
    if (isDesignRun(run)) {
      const problem = widthProblem(viewport, capture.design?.width);
      if (problem) return problem;
    }
  }
  return null;
}
