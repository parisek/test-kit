// Group names. A report may name its own groups (meta.groups); the language groups of the page reports stay built in.
const BUILT_IN = { cs: 'Čeština', en: 'English', de: 'Deutsch' };

export function groupLabel(report, key) {
	return report?.meta?.groups?.[key] ?? BUILT_IN[key] ?? key;
}
