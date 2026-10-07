// The command line. One table lists every command; a command that is planned but not built says so and exits with 2.
// Specification: docs/specification.md, section 4 (architecture) and section 11 (agent interface).
export const COMMANDS = {
	capture: { status: 'planned', summary: 'Capture one side into a named run (visual:capture).' },
	diff: { status: 'planned', summary: 'Compare two runs and write the report (visual:diff).' },
	serve: { status: 'planned', summary: 'Serve the viewer over a report.' },
	summary: { status: 'planned', summary: 'Print the short digest of a report for an agent.' },
};

const HELP = [
	'test-kit: testing and comparison tool for sites',
	'',
	'Usage: test-kit <command> [options]',
	'',
	'Commands:',
	...Object.entries(COMMANDS).map(([name, { summary, status }]) => `  ${name.padEnd(9)}${summary}${status === 'planned' ? ' (planned)' : ''}`),
	'',
	'Options:',
	'  -h, --help     Show this help.',
	'  -v, --version  Show the version.',
	'',
].join('\n');

/** Run the command line. Returns the exit code: 0 done, 1 usage error, 2 command planned but not built. */
export async function run(argv, { out, err }, version = '0.0.0') {
	const [command] = argv;
	if (!command || command === '-h' || command === '--help') { out.write(HELP); return 0; }
	if (command === '-v' || command === '--version') { out.write(`${version}\n`); return 0; }
	if (!Object.hasOwn(COMMANDS, command)) { err.write(`Unknown command: ${command}\nRun test-kit --help.\n`); return 1; }
	err.write(`The command "${command}" is planned and not built yet. See docs/specification.md.\n`);
	return 2;
}
