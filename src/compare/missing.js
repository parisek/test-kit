// R8.19, #412: the diagnostic of a cell that one run does not hold. It names the run and the cell, so a person
// sees that a target or a viewport is new or renamed in one run. Pure: no DOM, no file system.
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const plain = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;

// `ac` and `bc` are the captures of the cell in run A and run B; `a` and `b` the runs. Null when both runs hold the cell.
export function missingCellDiagnostic({ targetId, viewportId, ac, bc, a, b }) {
	const missing = [[ac, a, 'A'], [bc, b, 'B']].filter(([capture]) => !capture);
	if (!missing.length) return null;
	const target = plain(targetId, ID) ?? 'unknown target';
	const viewport = plain(viewportId, ID) ?? 'unknown viewport';
	const runs = missing.map(([, run, side]) => { const id = plain(run?.id, RUN_ID); return id ? `run ${side} (${id})` : `run ${side}`; });
	return missing.length === 2
		? `Target ${target} at ${viewport} is in neither ${runs[0]} nor ${runs[1]}. Capture both sides again.`
		: `Target ${target} at ${viewport} is not in ${runs[0]}. Capture that side again.`;
}
