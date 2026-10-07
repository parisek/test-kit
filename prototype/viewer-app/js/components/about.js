// "O návrhu": an in-page dialog. Escape is handled by the app (actions.escape).
import { h } from '../dom.js';
import { PAIR_KINDS } from '../pairs.js';
import { VIEW_LABELS } from './pair-bar.js';

export function aboutPanel(ctx) {
	const { actions } = ctx;
	const close = h('button', { class: 'about-close', type: 'button', 'data-focus': 'about-close', on: { click: actions.toggleAbout } }, 'Zavřít');
	const panel = h('div', { class: 'about-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'O návrhu' },
		close,
		h('h2', {}, 'O návrhu'),
		h('p', {}, 'Jeden prohlížeč, více pohledů nad jedním report.json. Druh páru určuje, který pohled se otevře jako první.'),
		h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
			h('thead', {}, h('tr', {}, h('th', {}, 'Druh páru'), h('th', {}, 'Výchozí pohled'), h('th', {}, 'Proč'))),
			h('tbody', {}, PAIR_KINDS.map((kind) => h('tr', {}, h('td', {}, kind.label), h('td', {}, VIEW_LABELS[kind.defaultView]), h('td', {}, kind.why)))))),
		h('p', {}, 'Běhy zůstávají lokálně v tests/visual/runs/ a v gitu nejsou.'),
		h('p', {}, 'report.json: schemaVersion 2, starý report verze 1 se čte beze změny.'),
		h('p', {}, 'Práh 3 % je kompas, ne verdikt pro každý pár. Řádky s judge: oracle mají vlastní zpracování.'));
	const overlay = h('div', { class: 'about', on: { click: (event) => { if (event.target === overlay) actions.toggleAbout(); } } }, panel);
	// The redraw replaced the control that had focus; put focus into the dialog.
	queueMicrotask(() => close.focus({ preventScroll: true }));
	return overlay;
}
