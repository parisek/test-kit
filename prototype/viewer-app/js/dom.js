// Tiny DOM helper. Strings become text nodes, never HTML, so report data cannot inject markup.
const BOOLEAN = new Set(['disabled', 'hidden', 'checked', 'selected', 'open', 'readOnly']);

/**
 * h('button', { class: 'chip', 'aria-pressed': true, on: { click: fn }, dataset: { id: 'x' } }, 'Text', child)
 * Props: class, dataset, on, text, boolean props, `aria-*` / `data-*` / `role` / other attributes.
 * Children: strings and numbers (text), nodes, arrays (flattened); null, undefined and false are skipped.
 */
export function h(tag, props = {}, ...children) {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(props ?? {})) {
		if (value == null) continue;
		// ARIA states are strings: aria-pressed="false" differs from a missing attribute.
		if (key.startsWith('aria-') && typeof value === 'boolean') { el.setAttribute(key, String(value)); continue; }
		if (value === false) continue;
		if (key === 'class') el.className = value;
		else if (key === 'text') el.textContent = value;
		else if (key === 'dataset') Object.assign(el.dataset, value);
		else if (key === 'on') for (const [type, fn] of Object.entries(value)) el.addEventListener(type, fn);
		else if (BOOLEAN.has(key)) el[key] = Boolean(value);
		else el.setAttribute(key, value === true ? '' : String(value));
	}
	append(el, children);
	return el;
}

function append(parent, children) {
	for (const child of children) {
		if (child == null || child === false) continue;
		if (Array.isArray(child)) append(parent, child);
		else if (child instanceof Node) parent.append(child);
		else parent.append(document.createTextNode(String(child)));
	}
}

export function clear(node) {
	node.replaceChildren();
	return node;
}

export function mount(parent, ...children) {
	clear(parent);
	append(parent, children);
	return parent;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
