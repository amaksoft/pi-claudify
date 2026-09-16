/** Private-use sentinel consumed by wrapMarkedLine for hanging indentation. */
export const WRAP_MARK = "\uE000";

/** Marks where bytes were removed, so a strip can never read as "nothing was here". */
const SANITIZED_MARK = "\ufffd";

/**
 * Ordered rewrite rules for sanitizeToolText, built once.
 *
 * Order matters: terminated envelopes must go before the bare-ESC rule, or the
 * catch-all breaks an envelope into text that reads as content. Global regexes
 * are safe to share here: String.replace resets lastIndex, unlike test/exec.
 */
const SANITIZE_RULES: Array<readonly [RegExp, string]> = [
	// Properly terminated envelopes carry no readable text: drop them whole.
	[/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, ""],
	[/\u001b[P_^X][\s\S]*?\u001b\\/g, ""],
	// An UNTERMINATED envelope must not swallow the rest of the string. Strip the
	// introducer, mark it, and keep the readable tail.
	[/\u001b[P_^X]/g, SANITIZED_MARK],
	[/\u001b\[[0-9;:?]*[ -\/]*[@-~]/g, ""],
	// Charset designators are three bytes (ESC ( 0); consume the final byte too.
	[/\u001b[()*+$][0-~]/g, ""],
	[/\u001b#[0-9]/g, ""],
	[/\u001b/g, SANITIZED_MARK],
	[new RegExp(WRAP_MARK, "g"), ""],
	// Fold line/whitespace controls to a space so model text cannot forge rows.
	[/[\u0009-\u000d\u0085\u2028\u2029]/g, " "],
	[/[\u0000-\u001f\u007f-\u009f]/g, ""],
	// Bidi overrides reorder audit text; zero-width characters split commands
	// invisibly. Neither belongs in a tool row.
	[/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ""],
];

/**
 * Cheap pre-check. WRAP_MARK is Private Use rather than a control character, so
 * it must be included explicitly.
 */
const SANITIZE_SCAN = new RegExp(
	`[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\u2028\\u2029\\ufeff${WRAP_MARK}]`,
);

/**
 * Strip terminal control bytes from model-supplied row text while preserving a
 * visible marker when silent deletion would misrepresent what ran.
 */
export function sanitizeToolText(text: unknown): string {
	let out = typeof text === "string" ? text : String(text ?? "");
	if (!SANITIZE_SCAN.test(out)) return out;
	for (const [pattern, replacement] of SANITIZE_RULES) out = out.replace(pattern, replacement);
	return out;
}

/** Sanitize each logical output line without erasing its real line boundaries. */
export function sanitizeToolOutput(text: unknown): string {
	const raw = typeof text === "string" ? text : String(text ?? "");
	return raw.split("\n").map(sanitizeToolText).join("\n");
}
