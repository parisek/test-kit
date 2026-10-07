// One screenshot slot. Real report: an <img> of artifacts.screenshot[side].src.
// Sample report: a wireframe drawn from entry.sample.layout (dev only). Otherwise a "Bez snímku" box.
// Regions of the diff overlay are drawn only when the report says they are percentages.
import { h } from '../dom.js';

// side 'a' = production, 'b' = local. Contact differs: production shows the Turnstile widget and is taller.
function layout(kind, side) {
	if (kind === 'contact') {
		const blocks = [['bar', 0, 8], ['hero', 10, 22], ['txt', 36, 10], ['form', 50, 38]];
		if (side === 'a') blocks.push(['widget', 74, 9]);
		blocks.push(['foot', side === 'a' ? 92 : 86, 8]);
		return blocks;
	}
	if (kind === 'home') return [['bar', 0, 8], ['hero', 10, 30], ['txt', 44, 8], ['num', 56, 14], ['card', 74, 14], ['foot', 92, 8]];
	if (kind === 'article') return [['bar', 0, 8], ['hero', 10, 20], ['txt', 34, 30], ['card', 68, 20], ['foot', 92, 8]];
	return [['bar', 0, 8], ['card', 12, 18], ['card', 34, 18], ['card', 56, 18], ['foot', 92, 8]];
}

/** Page height as a share of its width, by viewport width: wider pages are shorter in the drawing. */
function padding(width) {
	return width >= 1024 ? 62 : width >= 768 ? 78 : 150;
}

function overlay(diff) {
	if (!diff || diff.regionsUnit !== 'percent') return [];
	return (diff.regions ?? []).map((r) => h('div', {
		class: 'stage-hit',
		style: `left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%`,
	}));
}

export function stage({ report, target, viewportId, side, regions = false }) {
	const viewport = target.viewports.find((entry) => entry.id === viewportId);
	const shot = viewport?.artifacts?.screenshot;
	const hits = regions ? overlay(shot?.diff) : [];
	const src = shot?.[side]?.src;
	const label = `${target.title ?? target.id}, ${viewportId}, strana ${side.toUpperCase()}`;

	if (src) return h('div', { class: 'stage' }, h('img', { class: 'stage-img', src, alt: label, loading: 'lazy' }), hits);

	const kind = target.sample?.layout;
	if (!kind) return h('div', { class: 'stage stage-empty', role: 'img', 'aria-label': label }, 'Bez snímku');

	const width = report.meta.viewports.find((entry) => entry.id === viewportId)?.width ?? 1280;
	const blocks = layout(kind, side).map(([name, top, height]) => h('div', { class: `stage-blk stage-${name}`, style: `top:${top}%;height:${height}%` }));
	return h('div', { class: 'stage', role: 'img', 'aria-label': `${label} (náčrt)` },
		h('div', { class: 'stage-page', style: `padding-top:${padding(width)}%` }, blocks, hits));
}
