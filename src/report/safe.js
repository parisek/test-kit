// Pure guards for untrusted report paths (R4.4, R10.6).
export function relativePath(value) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(value)) return null;
	if (value.split('/').some((part) => !part || part === '.' || part === '..')) return null;
	return value;
}

export function sameOriginUrl(value, base) {
	if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value) || value.startsWith('//')) return null;
	try {
		const root = new URL(base);
		const url = new URL(value, root);
		const directory = new URL('.', root).pathname;
		// Encoded separators can change the path after a server decodes it.
		if (/%(?:2f|5c|25)/i.test(url.pathname)) return null;
		const path = decodeURIComponent(url.pathname);
		const prefix = decodeURIComponent(directory);
		return ['http:', 'https:'].includes(url.protocol) && url.origin === root.origin
			&& !url.username && !url.password && path.startsWith(prefix) ? url.href : null;
	} catch { return null; }
}
