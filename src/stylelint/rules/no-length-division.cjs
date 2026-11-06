/**
 * portadesign/no-length-division
 *
 * Disallow dividing by a length inside a CSS math function.
 *
 * `calc()` and its siblings divide by a NUMBER. Dividing a length by a length
 * is a CSS Values 4 addition: Chromium and WebKit implement it, Firefox does
 * not. Firefox rejects the whole declaration, which for a custom property
 * means invalid at computed-value time — every `var()` that reads it then
 * falls back to `unset`, and for `font-size` that means inherited.
 *
 * The failure is silent in every channel that normally reports one. The CSS
 * parses, the build succeeds, the console stays quiet, and Chromium renders
 * the intended result. A 2026-09 launch of a first consumer project shipped nine
 * such tokens; in Firefox every heading on the site rendered at body size, and
 * the client reported it after go-live.
 *
 *   FAIL  calc(100vw / 100px)
 *   FAIL  clamp(2rem, 2rem + 3rem * (100vw - 768px) / (1600px - 768px), 5rem)
 *   PASS  calc(100vw / 8)
 *   PASS  clamp(2rem, 2rem + 36 * (100vw - 768px) / var(--fluid-span-md), 5rem)
 *
 * A `var()` divisor is resolved against the custom properties the same
 * stylesheet declares, so `var(--breakpoint-md)` counts as a length and
 * `var(--fluid-span-md)` does not. A property declared in another file cannot
 * be resolved and is left alone — see resolve() below for why that gap is
 * deliberate and what covers it.
 */

const stylelint = require("stylelint");

const ruleName = "portadesign/no-length-division";

const messages = stylelint.utils.ruleMessages(ruleName, {
	rejected: (divisor) =>
		`Dividing by the length "${divisor}" is invalid in Firefox — calc() divides by a number. Move the unit into the multiplier and divide by a unitless value.`,
});

// Math functions whose arguments are a calc-sum. `/` anywhere inside one of
// these is division; `/` outside them is a separator (grid-area, font
// shorthand, border-radius, aspect-ratio) and must never be reported.
const MATH_FUNCTIONS = new Set([
	"calc", "min", "max", "clamp", "round", "mod", "rem",
	"abs", "sign", "hypot", "pow", "sqrt", "log", "exp",
	"sin", "cos", "tan", "asin", "acos", "atan", "atan2",
]);

// Any dimension unit that makes the operand a length-ish quantity rather than
// a number. `%` counts: it is not a number either, and it needs its own branch
// because a word boundary after `%` never matches — `50%)` has non-word
// characters on both sides, so `%\b` silently passes every percentage.
const UNIT = /\d(?:\.\d+)?(?:e[+-]?\d+)?(?:%|(?:px|rem|em|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|svi|svb|svmin|svmax|lvw|lvh|lvi|lvb|lvmin|lvmax|dvw|dvh|dvi|dvb|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pt|pc|deg|grad|rad|turn|s|ms|hz|khz|dpi|dpcm|dppx|fr)(?![\w-]))/i;

/**
 * Substitute custom properties this file declares, then report what is left.
 *
 * The shape that shipped divides by `(var(--breakpoint-2xl) - var(--breakpoint-md))`
 * — an expression with no literal unit anywhere in it. A rule that only reads
 * literals is blind to the exact defect it exists to catch, and one that treats
 * every `var()` divisor as suspect flags the remedy, `var(--fluid-span-md)`,
 * just as loudly.
 *
 * So the values are resolved instead of guessed. Both of those properties are
 * declared in the same stylesheet: `--breakpoint-md: 768px` is provably a
 * length, `--fluid-span-md: 832` is provably a number. Substituting turns the
 * question back into the one this rule can answer.
 *
 * A property declared in another file stays unresolved and is NOT reported.
 * That gap is deliberate and is covered from the other side by
 * `tests/lib/fluid-spans.test.js` and by the sync-skeleton config invariant,
 * both of which read the declaration rather than the division.
 */
function collectCustomProperties(root) {
	const declared = new Map();
	root.walkDecls((decl) => {
		if (decl.prop.startsWith("--")) declared.set(decl.prop, decl.value);
	});
	return declared;
}

/**
 * Expand `var()` against `declared`, up to `depth` levels of indirection.
 *
 * Bounded rather than run to a fixed point: `--a: var(--b); --b: var(--a)` is
 * legal CSS to write and would spin forever. The bound was 4 and a 5-deep
 * alias chain went unreported (found in review); 10 is past any plausible
 * hand-written chain while still terminating on a cycle.
 */
function resolve(input, declared, depth = 10) {
	if (depth === 0) return input;
	let out = "";
	let expanded = false;
	for (let i = 0; i < input.length; i++) {
		if (!input.startsWith("var(", i)) {
			out += input[i];
			continue;
		}
		let level = 0;
		const start = i;
		while (i < input.length) {
			if (input[i] === "(") level++;
			else if (input[i] === ")" && --level === 0) break;
			i++;
		}
		const inner = input.slice(start + 4, i);
		const comma = splitTopLevelComma(inner);
		const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
		// A fallback is used when the property is unknown here: `var(--x, 832px)`
		// divides by a length whenever `--x` is unset, so it counts.
		const value = declared.has(name)
			? declared.get(name)
			: comma === -1
				? ""
				: inner.slice(comma + 1);
		out += value;
		expanded = expanded || value !== "";
	}
	return expanded ? resolve(out, declared, depth - 1) : out;
}

/** Index of the first comma not nested inside parentheses, or -1. */
function splitTopLevelComma(input) {
	let depth = 0;
	for (let i = 0; i < input.length; i++) {
		if (input[i] === "(") depth++;
		else if (input[i] === ")") depth--;
		else if (input[i] === "," && depth === 0) return i;
	}
	return -1;
}

/**
 * Read the operand that starts at `index`. Returns the raw text of a balanced
 * parenthesised group, or of a single token (which may itself be a function
 * call with its own parentheses).
 */
function readOperand(value, index) {
	let i = index;
	while (i < value.length && /\s/.test(value[i])) i++;
	const start = i;
	if (value[i] === "(") {
		let depth = 0;
		while (i < value.length) {
			if (value[i] === "(") depth++;
			else if (value[i] === ")" && --depth === 0) { i++; break; }
			i++;
		}
		return value.slice(start, i);
	}
	let depth = 0;
	while (i < value.length) {
		const ch = value[i];
		if (ch === "(") depth++;
		else if (ch === ")") { if (depth === 0) break; depth--; }
		else if (depth === 0 && (/\s/.test(ch) || ch === "," || ch === "*" || ch === "/")) break;
		i++;
	}
	return value.slice(start, i);
}

/**
 * Walk `value` and return the raw text of every divisor that sits inside a
 * math function and carries a unit. The stack tracks whether the innermost
 * enclosing function is a math one, so a `/` inside `url(a/b)` or a
 * `grid-area` shorthand is never reached.
 */
function offendingDivisors(value, declared) {
	const found = [];
	const stack = [];
	let inMath = false;

	for (let i = 0; i < value.length; i++) {
		const ch = value[i];

		if (ch === "(") {
			const name = (value.slice(0, i).match(/([\w-]+)$/) || [, ""])[1].toLowerCase();
			stack.push(inMath);
			// A non-math function nested in a math one (a var() fallback, say)
			// closes the math context until it ends.
			inMath = MATH_FUNCTIONS.has(name) ? true : name === "" ? inMath : false;
			continue;
		}
		if (ch === ")") {
			inMath = stack.length ? stack.pop() : false;
			continue;
		}
		if (ch !== "/" || !inMath) continue;

		const operand = readOperand(value, i + 1);
		if (operand && UNIT.test(resolve(operand, declared))) found.push(operand);
	}
	return found;
}

const ruleFunction = (primary) => (root, result) => {
	const validOptions = stylelint.utils.validateOptions(result, ruleName, {
		actual: primary,
		possible: [true, false],
	});
	if (!validOptions || !primary) return;

	const declared = collectCustomProperties(root);

	const check = (node, text) => {
		if (!text || !text.includes("/")) return;
		for (const divisor of offendingDivisors(text, declared)) {
			stylelint.utils.report({
				message: messages.rejected(divisor),
				node,
				result,
				ruleName,
				word: divisor,
			});
		}
	};

	root.walkDecls((decl) => check(decl, decl.value));

	// At-rule conditions carry calc() too, and Firefox rejects the division
	// there for the same reason — which makes the whole condition invalid, so
	// the query never matches and every rule inside it is dead. Found in review:
	// the rule walked declarations only, so `@media (width: calc(100vw / 10px))`
	// passed. `@container` is included because it takes the same query syntax.
	root.walkAtRules(/^(media|supports|container)$/i, (atRule) => check(atRule, atRule.params));
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;

module.exports = stylelint.createPlugin(ruleName, ruleFunction);
