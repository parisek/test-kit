// One byte limit for the output of `summary` and `query` (R11.2). The behavior query used 60000
// bytes first. Report data is untrusted, so a count limit alone does not bound an answer.
export const OUTPUT_BYTE_LIMIT = 60000;

export const outputBytes = (value) => Buffer.byteLength(JSON.stringify(value));

// A string cut to a length. A non-string reads as an empty string.
export const clip = (value, length) => typeof value === 'string' ? value.slice(0, length) : '';

// An id cut to a length. A cut id ends with an ellipsis, so a reader sees that it will not match --target.
export const markCut = (value, length = 200) => typeof value === 'string' && value.length > length ? value.slice(0, length - 1) + '\u2026' : typeof value === 'string' ? value : '';
export const wasCut = (value, length = 200) => typeof value === 'string' && value.length > length;

// Halve the largest bounded list of an answer until it fits. Each cut adds to the omitted counter
// of that list, so the answer says what it left out. A caller gives the lists as { owner, key, counter }.
export function fitLists(result, lists, limit = OUTPUT_BYTE_LIMIT) {
	while (outputBytes(result) > limit) {
		const live = lists().filter(({ owner, key }) => Array.isArray(owner[key]) && owner[key].length);
		if (!live.length) return false;
		const widest = live.reduce((best, item) => outputBytes(item.owner[item.key]) > outputBytes(best.owner[best.key]) ? item : best);
		const { owner, key, counter } = widest;
		const keep = Math.floor(owner[key].length / 2);
		const removed = owner[key].length - keep;
		owner[key] = owner[key].slice(0, keep);
		owner[counter] = (Number.isInteger(owner[counter]) ? owner[counter] : 0) + removed;
		if ('displayedLines' in owner && key === 'lines') owner.displayedLines = keep;
	}
	return true;
}
