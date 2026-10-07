// The kinds of comparison the viewer knows, and the view each one opens first.
// Source of the table: the owner-approved plan (tailwind-base issue, chapter "One viewer, several views").
export const VIEW_IDS = ['cile', 'matice', 'nalezy', 'osa'];

export const PAIR_KINDS = [
	{ id: 'reference-styleguide', label: 'Reference proti styleguidu', defaultView: 'cile', a: 'reference · živý web', b: 'styleguide · render', why: 'Doktrína chce rozhodování po viewportech vedle sebe.' },
	{ id: 'styleguide-before-after', label: 'Styleguide před a po', defaultView: 'matice', a: 'styleguide · běh před', b: 'styleguide · běh teď', why: 'První otázka: který dosud čistý viewport se změnil.' },
	{ id: 'local-before-after', label: 'Lokál před a po', defaultView: 'nalezy', a: 'local · běh před', b: 'local · běh po', why: 'HTML, stav a chování často vysvětlí pohyb snímku.' },
	{ id: 'production-local', label: 'Produkce proti lokálu', defaultView: 'nalezy', a: 'production · běh před deployem', b: 'local · běh teď', why: 'Rozdíly prostředí a známé rozdíly převažují.' },
	{ id: 'production-before-after', label: 'Produkce před a po', defaultView: 'matice', a: 'production · běh před', b: 'production · běh po', why: 'První otázka: jak velký je dosah deploye.' },
	{ id: 'adhoc', label: 'Ad hoc URL', defaultView: 'cile', a: 'strana A · URL', b: 'strana B · URL', why: 'Nejdřív se ověří podmínky snímání.' },
];

export function pairKind(id) {
	return PAIR_KINDS.find((kind) => kind.id === id) ?? PAIR_KINDS[0];
}

export function defaultViewFor(kindId) {
	return pairKind(kindId).defaultView;
}
