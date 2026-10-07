// The three non-screenshot artifacts of a target: HTML diff, status table, behaviour panel.
// Missing artifact -> an empty state, never an exception.
import { h } from '../dom.js';
import { rulesFor } from '../rules.js';
import { stepsPanel } from './steps.js';

const STATE_TEXT = { eq: ['eq', 'shodné'], ex: ['ex', 'liší se, prostředí'], ne: ['ne', 'liší se'] };

function empty(text) {
	return h('div', { class: 'empty' }, text);
}

function pairTable(head, rows) {
	return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
		h('thead', {}, h('tr', {}, head.map((cell) => h('th', {}, cell)))),
		h('tbody', {}, rows)));
}

export function htmlDiff(ctx, target) {
	const { report, state, actions } = ctx;
	const rows = target.artifacts?.html?.rows;
	if (!rows?.length) return empty('Žádná data o HTML pro tento cíl.');
	const normalize = state.ui.normalize;
	const { used, others } = rulesFor(report, target, state.pairKind, 'html');
	// A rule hides a row only inside its scope. Outside it the row is a real difference and stays visible.
	const hides = (row) => Boolean(row.noise) && (!report.rules?.[row.noise] || used.some((rule) => rule.id === row.noise));
	const shown = rows.filter((row) => !(normalize && hides(row)));
	const hidden = rows.length - shown.length;

	const lines = shown.map((row) => {
		const outOfScope = row.noise && !hides(row);
		const tag = hides(row) ? `pravidlo: ${row.noise}` : outOfScope ? `pravidlo mimo rozsah: ${row.noise}` : row.known ? `známý rozdíl: ${row.known}` : '';
		const kind = row.k === '+' ? 'add' : row.k === '-' ? 'del' : '';
		return h('div', { class: `ln ${kind}${hides(row) ? ' noise' : ''}` },
			h('span', { class: 'ln-no' }, String(row.n)),
			h('span', {}, row.k === ' ' ? '' : row.k),
			h('span', { class: 'ln-src' }, row.s),
			h('span', { class: 'ln-tag' }, tag));
	});

	const toggle = (value, label) => h('button', {
		type: 'button', 'aria-pressed': String(normalize === value), 'data-focus': `normalize-${value ? 'on' : 'off'}`,
		on: { click: () => actions.setNormalize(value) },
	}, label);

	return h('div', { class: 'html-diff' },
		h('div', { class: 'bar' },
			h('span', { class: 'lbl' }, 'Normalizace'),
			h('div', { class: 'seg' }, toggle(true, 'Zapnutá'), toggle(false, 'Syrová')),
			h('span', { class: 'meta' }, 'Server HTML, ne DOM po skriptech. ',
				normalize ? [h('b', {}, String(hidden)), ' řádků skryto pravidly páru.'] : 'Všechny řádky včetně šumu prostředí.')),
		h('div', { class: 'diff' }, lines, normalize && hidden
			? h('div', { class: 'diff-hidden' }, `${hidden} řádků odečteno pravidly níže. Každé pravidlo nese důkaz.`) : null),
		h('div', { class: 'cols' },
			h('div', { class: 'card' }, h('h3', {}, 'Pravidla použitá pro tento cíl'),
				used.length ? h('ul', { class: 'rules' }, used.map((rule) => h('li', {}, h('code', {}, rule.id), rule.text ? ` · ${rule.text}` : '',
					rule.evidence ? h('div', { class: 'rule-evidence' }, `Důkaz: ${rule.evidence}`) : null)))
					: h('p', { class: 'meta' }, 'Na tomto cíli se žádné pravidlo nepoužilo. Rozdíly výše jsou skutečné.'),
				others.length ? h('details', { class: 'rules-others' },
					h('summary', {}, `Další pravidla v tomto kontextu (${others.length})`),
					h('ul', { class: 'rules' }, others.map((rule) => h('li', {}, h('code', {}, rule.id), rule.text ? ` · ${rule.text}` : '')))) : null),
			h('div', { class: 'card' }, h('h3', {}, 'Proč patří páru'),
				h('ul', {},
					h('li', {}, 'Pravidlo platí jen pro situaci, kterou jeho rozsah popisuje: druh páru, artefakt, druh cíle.'),
					h('li', {}, 'Pravidlo, které běží všude, by mohlo schovat skutečnou regresi.')))));
}

export function statusTable(target) {
	const rows = target.artifacts?.status?.rows;
	if (!rows?.length) return empty('Žádná data o stavu pro tento cíl.');
	return h('div', {},
		pairTable(['Měření', 'A', 'B', 'Výsledek'], rows.map(([label, a, b, state]) => {
			const [cls, text] = STATE_TEXT[state] ?? ['', state ?? ''];
			return h('tr', {}, h('td', {}, label), h('td', { class: 'code' }, a), h('td', { class: 'code' }, b), h('td', { class: cls }, text));
		})),
		h('div', { class: 'cols' }, h('div', { class: 'card' }, h('h3', {}, 'Jak číst'), h('ul', {},
			h('li', {}, 'Počty assetů se hlásí zvlášť, protože normalizace odečítá odkazy na agregované soubory.'),
			h('li', {}, 'Rozdíl počtů CSS a JS je očekávaný: produkce agreguje, lokál ne.')))));
}

export function behaviorPanel(target, ctx = null) {
	const behavior = target.artifacts?.behavior;
	const steps = stepsPanel(target, ctx);
	if (!behavior?.rows?.length && !steps) return empty('Žádná data o chování pro tento cíl.');
	const table = behavior.rows?.length
		? pairTable(['Položka', 'A', 'B', 'Výsledek'], behavior.rows.map((row) => h('tr', {},
			h('td', {}, row.n), h('td', { class: 'code' }, row.a), h('td', { class: 'code' }, row.b),
			h('td', { class: row.st === 'eq' ? 'eq' : 'ne' }, row.st === 'eq' ? 'shodné' : 'liší se'))))
		: null;
	const cards = [];
	if (behavior.push) cards.push(h('div', { class: 'card' }, h('h3', {}, 'Push strany B'), h('pre', { class: 'push' }, behavior.push)));
	if (behavior.verdict) cards.push(h('div', { class: 'card' }, h('h3', {}, 'Verdikt'),
		h('div', { class: 'finding bad' }, h('b', {}, 'Liší se'), h('span', {}, behavior.verdict))));
	return h('div', {}, behavior.note ? h('p', { class: 'meta behavior-note' }, behavior.note) : null, table,
		cards.length ? h('div', { class: 'cols' }, cards) : null, steps);
}
