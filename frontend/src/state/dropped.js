// R3.8: aborted font and stylesheet requests of a remote side. Report data is untrusted,
// so each part is checked and bounded, and a malformed entry is dropped. The viewer shows
// the values as text only. This mirrors src/report/dropped.js; the viewer build is isolated.
const TYPES = ['font', 'stylesheet'];
const ORIGIN = /^https?:\/\/[A-Za-z0-9.:[\]-]{1,95}$/;

export function droppedRenderRequests(report) {
    const groups = new Map();
    let count = 0;
    let notListed = 0;
    for (const target of report?.entries ?? []) for (const row of target.viewports ?? []) {
        const dropped = row?.dropped && typeof row.dropped === 'object' ? row.dropped : {};
        for (const side of ['a', 'b']) {
            const cut = dropped.omitted?.[side];
            if (Number.isInteger(cut) && cut > 0 && cut <= 1_000_000) notListed += cut;
            for (const item of Array.isArray(dropped[side]) ? dropped[side].slice(0, 50) : []) {
                if (!item || !TYPES.includes(item.resourceType) || typeof item.origin !== 'string' || !ORIGIN.test(item.origin)) continue;
                if (!Number.isInteger(item.count) || item.count < 1 || item.count > 1_000_000) continue;
                count += item.count;
                const key = `${side}\n${item.resourceType}\n${item.origin}`;
                groups.set(key, { side: side.toUpperCase(), resourceType: item.resourceType, origin: item.origin });
            }
        }
    }
    return { count, notListed, groups: [...groups.values()] };
}
