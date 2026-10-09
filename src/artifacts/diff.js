// Linear replacement window. This is not a minimal edit script.
export function lineWindow(a, b, { maxLines = 100, maxLineLength = 2000 } = {}) {
  const before = a.split('\n'), after = b.split('\n');
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endA = before.length, endB = after.length;
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) { endA--; endB--; }
  const removedLines = endA - start, addedLines = endB - start;
  const lines = [];
  for (const [kind, rows, end] of [['removed', before, endA], ['added', after, endB]]) {
    for (let index = start; index < end && lines.length < maxLines; index++) {
      lines.push({ kind, line: index + 1, text: rows[index].slice(0, maxLineLength),
        truncated: rows[index].length > maxLineLength });
    }
  }
  return { method: 'prefix-suffix-replacement', removedLines, addedLines,
    displayedLines: lines.length, omittedLines: removedLines + addedLines - lines.length, lines };
}

// Bound the combined JSON, including escaped raw and normalized text.
export function boundedDifference(detail, maxBytes = 2 * 1024 * 1024) {
  const windows = [detail, detail.rawWindow].filter(Boolean);
  while (new TextEncoder().encode(JSON.stringify(detail)).length > maxBytes) {
    const window = windows.filter(window => window.lines.length).sort((a, b) => b.lines.length - a.lines.length)[0];
    if (!window) throw new Error('Difference metadata exceeds its limit.');
    window.lines.pop();
    window.displayedLines = window.lines.length;
    window.omittedLines = window.removedLines + window.addedLines - window.lines.length;
  }
  return detail;
}
