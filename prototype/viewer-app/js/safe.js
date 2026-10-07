// Report data is untrusted: a report can come from a link, a shared folder or a CI artefact.
// Three guards, all pure, so they run in node:test.

/**
 * A URL that stays on the page's own origin, or null.
 * Relative paths pass. `javascript:`, `data:`, other schemes, protocol-relative URLs and other origins do not.
 */
export function sameOriginUrl(value, base) {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	// Control characters hide a scheme from a naive check ("java\tscript:"). Browsers strip them while parsing.
	if (!text || /[\u0000-\u001f\u007f]/.test(text) || text.startsWith('//') || text.startsWith('\\\\')) return null;
	let root;
	try { root = new URL(base); } catch { return null; }
	let url;
	try { url = new URL(text, root); } catch { return null; }
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	return url.origin === root.origin ? url.href : null;
}

/** A path that is safe to paste into a shell as one word: relative, plain characters, no `..`, no leading `-`. */
export function safeRunPath(value) {
	if (typeof value !== 'string') return null;
	if (!/^[A-Za-z0-9._][A-Za-z0-9._\-/]*$/.test(value)) return null;
	if (value.split('/').some((part) => part === '..')) return null;
	return value;
}

export const URL_ATTRIBUTES = new Set(['src', 'href', 'poster']);
