// The recorded procedure of a behaviour test: ordered steps, the outcome on each side, and the evidence the test kept.
// A procedure is a sequence, so the list is numbered. Evidence that has no `src` is a labelled placeholder ("ukázka").
// Recordings (a Playwright trace, a video) stay on the developer's machine under tests/visual/runs/; the viewer shows
// how to open them and never embeds them.
import { h } from '../dom.js';
import { causeIsKnown } from '../classify.js';
import { safeRunPath } from '../safe.js';

const STATUS_TEXT = { same: 'Shodné', changed: 'Liší se', failed: 'Selhalo' };
const KIND_TEXT = { screenshot: 'Snímek', console: 'Konzole', network: 'Síť', datalayer: 'dataLayer', dom: 'DOM' };

// The path comes from the report. It goes to a clipboard and then to a shell, so only plain relative paths pass.
export function traceCommand(path) {
	const safe = safeRunPath(path);
	return safe ? `npx playwright show-trace ${safe}` : null;
}

function copyButton(text) {
	const button = h('button', { class: 'steps-copy', type: 'button' }, 'Kopírovat');
	button.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(text);
			button.textContent = 'Zkopírováno';
		} catch {
			// Older frames refuse the clipboard: select the command so Cmd+C works.
			const code = button.previousElementSibling;
			const range = document.createRange();
			range.selectNodeContents(code);
			const selection = getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
			button.textContent = 'Označeno';
		}
	});
	return button;
}

function frame(item) {
	const head = h('figcaption', {}, h('span', { class: `steps-side steps-side-${item.side}` }, item.side === 'a' ? 'A' : 'B'),
		h('span', { class: 'steps-kind' }, KIND_TEXT[item.kind] ?? item.kind), h('span', { class: 'steps-label' }, item.label ?? ''));
	let content;
	if (item.kind === 'screenshot') {
		content = item.src
			? h('img', { class: 'steps-img', src: item.src, alt: item.label ?? 'Snímek kroku', loading: 'lazy' })
			: h('div', { class: 'steps-placeholder' }, h('span', {}, 'ukázka'), h('small', {}, item.label ?? 'Snímek'));
	} else {
		content = h('pre', { class: 'steps-code' }, item.text ?? '—');
	}
	return h('figure', { class: `steps-frame steps-frame-${item.kind}` }, head, content);
}

function outcome(label, side) {
	return h('div', { class: 'steps-outcome' }, h('b', {}, label), h('span', {}, side?.text ?? '—'));
}

function stepItem(step, ctx) {
	const cause = step.causeId && ctx ? ctx.report.causes.find((entry) => entry.id === step.causeId) : null;
	const known = cause ? causeIsKnown(ctx.report, cause.id, ctx.known) : null;
	return h('li', { class: `steps-item steps-${step.status}` },
		h('div', { class: 'steps-head' },
			h('span', { class: 'steps-title' }, step.title),
			h('span', { class: `steps-pill steps-pill-${step.status}` }, STATUS_TEXT[step.status] ?? step.status),
			cause ? h('span', { class: `steps-cause${known ? '' : ' steps-cause-bad'}` }, `příčina: ${cause.title} · ${known ? 'známá' : 'neznámá'}`) : null),
		step.a || step.b ? h('div', { class: 'steps-ab' }, outcome('A', step.a), outcome('B', step.b)) : null,
		step.evidence?.length ? h('div', { class: 'steps-film', role: 'group', 'aria-label': `Důkazy kroku ${step.title}` }, step.evidence.map(frame)) : null);
}

function recordings(list) {
	if (!list?.length) return null;
	return h('div', { class: 'steps-rec' },
		h('h3', { class: 'lbl' }, 'Záznamy (jen lokálně, v gitu nejsou)'),
		list.map((rec) => {
			const side = h('span', { class: `steps-side steps-side-${rec.side}` }, rec.side === 'a' ? 'A' : 'B');
			if (rec.kind === 'trace') {
				const command = traceCommand(rec.path);
				if (!command) return h('div', { class: 'steps-rec-row' }, side, h('span', { class: 'steps-kind' }, 'Trace'), h('span', { class: 'steps-label' }, rec.label ?? ''), h('span', { class: 'muted' }, 'Cesta záznamu není bezpečná, příkaz se nezobrazí.'));
				return h('div', { class: 'steps-rec-row' }, side, h('span', { class: 'steps-kind' }, 'Trace'), h('span', { class: 'steps-label' }, rec.label ?? ''),
					h('code', { class: 'steps-cmd' }, command), copyButton(command));
			}
			return h('div', { class: 'steps-rec-row' }, side, h('span', { class: 'steps-kind' }, 'Video'), h('span', { class: 'steps-label' }, rec.label ?? ''),
				h('a', { class: 'steps-link', href: rec.path, target: '_blank', rel: 'noopener' }, rec.path));
		}));
}

/** stepsPanel(target, ctx?) -> Node | null. `ctx` is optional: with it a step shows its cause and whether it is known. */
export function stepsPanel(target, ctx = null) {
	const behavior = target.artifacts?.behavior;
	const steps = behavior?.steps ?? [];
	const recs = behavior?.recordings ?? [];
	if (!steps.length && !recs.length) return null;
	const changed = steps.filter((step) => step.status !== 'same').length;
	return h('section', { class: 'steps' },
		steps.length ? h('div', { class: 'steps-top' },
			h('h3', { class: 'lbl' }, `Postup (${steps.length} ${steps.length === 1 ? 'krok' : steps.length < 5 ? 'kroky' : 'kroků'})`),
			h('span', { class: 'meta' }, changed ? `${changed} z nich se liší nebo selhalo.` : 'Všechny kroky shodné.')) : null,
		steps.length ? h('ol', { class: 'steps-list' }, steps.map((step) => stepItem(step, ctx))) : null,
		recordings(recs));
}
