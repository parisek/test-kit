import { h } from '../dom.js';

// Deferred on purpose. A timeline needs immutable, named runs and stored comparison records; today the
// upstream run store overwrites its PNGs. See README.md, "What is not built yet".
export default {
	id: 'osa',
	label: 'Osa běhů',
	enabled: false,
	reason: 'Až po neměnném úložišti běhů',
	rail: () => h('div'),
	main: () => h('div', { class: 'state' }, 'Osa běhů zatím není k dispozici.'),
};
