/** Private-use sentinel consumed by wrapMarkedLine for hanging indentation. */
export const WRAP_MARK = "\uE000";

/** Marks where bytes were removed, so a strip can never read as "nothing was here". */
const SANITIZED_MARK = "\ufffd";

const METADATA_RULES: Array<readonly [RegExp, string]> = [
	[/\u001b\[[0-9;:?]*[ -\/]*[@-~]/g, ""],
	[/\u001b[()*+$][0-~]/g, ""],
	[/\u001b#[0-9]/g, ""],
	[/\u001b/g, SANITIZED_MARK],
	[new RegExp(WRAP_MARK, "g"), ""],
	[/[\u0009-\u000d\u0085\u2028\u2029]/g, " "],
	[/[\u0000-\u001f\u007f-\u009f]/g, ""],
	[/[\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, ""],
];

const CONTENT_RULES: Array<readonly [RegExp, string]> = [
	[/\u001b\[[0-9;:?]*[ -\/]*[@-~]/g, ""],
	[/\u001b[()*+$][0-~]/g, ""],
	[/\u001b#[0-9]/g, ""],
	[/\u001b/g, SANITIZED_MARK],
	[new RegExp(WRAP_MARK, "g"), "\\u{E000}"],
	[/\r/g, "\\r"],
	[/\u0085/g, "\\u{0085}"],
	[/\u2028/g, "\\u{2028}"],
	[/\u2029/g, "\\u{2029}"],
	[/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ""],
	// Keep ZWJ until complete grapheme validation below.
	[/[\u061c\u200b\u200c\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, ""],
];

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const VALID_EMOJI_ZWJ_CLUSTER = /^(?:\p{Extended_Pictographic}(?:\p{Grapheme_Extend}|\p{Emoji_Modifier})*)(?:\u200d\p{Extended_Pictographic}(?:\p{Grapheme_Extend}|\p{Emoji_Modifier})*)+$/u;
const SANITIZE_SCAN = new RegExp(
	`[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b-\\u200f\\u202a-\\u202e\\u2060\\u2066-\\u2069\\u2028\\u2029\\ufeff${WRAP_MARK}]`,
);

function isEnvelopeIntroducer(code: number): boolean {
	return code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f;
}

function unterminatedPayload(input: string, start: number): string {
	let out = "";
	for (let index = start; index < input.length;) {
		const code = input.charCodeAt(index);
		if (code === 0x1b && index + 1 < input.length && "]P_^X".includes(input[index + 1])) {
			out += SANITIZED_MARK;
			index += 2;
			continue;
		}
		if (isEnvelopeIntroducer(code)) {
			out += SANITIZED_MARK;
			index += 1;
			continue;
		}
		out += input[index];
		index += 1;
	}
	return out;
}

/** Strip OSC/DCS/APC/PM/SOS envelopes in linear time. */
function stripTerminalEnvelopes(input: string): string {
	let out = "";
	for (let index = 0; index < input.length;) {
		const code = input.charCodeAt(index);
		let kind = "";
		let payloadStart = index + 1;
		if (code === 0x1b && index + 1 < input.length && "]P_^X".includes(input[index + 1])) {
			kind = input[index + 1];
			payloadStart = index + 2;
		} else if (isEnvelopeIntroducer(code)) {
			kind = code === 0x9d ? "]" : "P";
		} else {
			out += input[index];
			index += 1;
			continue;
		}

		let cursor = payloadStart;
		let terminatedAt = -1;
		while (cursor < input.length) {
			const current = input.charCodeAt(cursor);
			if ((kind === "]" && current === 0x07) || current === 0x9c) {
				terminatedAt = cursor + 1;
				break;
			}
			if (current === 0x1b && input[cursor + 1] === "\\") {
				terminatedAt = cursor + 2;
				break;
			}
			cursor += 1;
		}
		if (terminatedAt >= 0) {
			index = terminatedAt;
			continue;
		}
		// No terminator exists in the remaining input. Preserve readable payload,
		// visibly marking every later introducer without rescanning its suffix.
		out += SANITIZED_MARK + unterminatedPayload(input, payloadStart);
		break;
	}
	return out;
}

function applyRules(input: string, rules: Array<readonly [RegExp, string]>): string {
	let out = stripTerminalEnvelopes(input);
	for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement);
	return out;
}

/** One-line terminal metadata: row controls fold to spaces and invisibles vanish. */
export function sanitizeToolText(text: unknown): string {
	const raw = typeof text === "string" ? text : String(text ?? "");
	if (!SANITIZE_SCAN.test(raw)) return raw;
	return applyRules(raw, METADATA_RULES);
}

/** Multiline source/output content: preserve tabs, LF, and valid emoji clusters. */
export function sanitizeToolContent(text: unknown): string {
	let raw = typeof text === "string" ? text : String(text ?? "");
	raw = raw.replace(/\r\n/g, "\n");
	if (!SANITIZE_SCAN.test(raw)) return raw;
	const out = applyRules(raw, CONTENT_RULES);
	if (!out.includes("\u200d")) return out;
	let validated = "";
	for (const { segment } of graphemeSegmenter.segment(out)) {
		validated += VALID_EMOJI_ZWJ_CLUSTER.test(segment) ? segment : segment.replaceAll("\u200d", "");
	}
	return validated;
}

export function sanitizeToolOutput(text: unknown): string {
	const raw = (typeof text === "string" ? text : String(text ?? "")).replace(/\r\n/g, "\n");
	return raw.split("\n").map(sanitizeToolContent).join("\n");
}

const CONTROL_NAMES: Record<number, string> = {
	0x00: "NUL", 0x07: "BEL", 0x08: "BS", 0x09: "TAB", 0x0a: "LF",
	0x0b: "VT", 0x0c: "FF", 0x0d: "CR", 0x1b: "ESC", 0x7f: "DEL",
};

/** Collision-free, reversible display encoding for executable command bytes. */
export function encodeCommandAuditText(text: unknown): string {
	const raw = typeof text === "string" ? text : String(text ?? "");
	let out = "";
	for (let index = 0; index < raw.length;) {
		const first = raw.charCodeAt(index);
		const codePoint = raw.codePointAt(index) ?? first;
		const char = String.fromCodePoint(codePoint);
		index += char.length;
		if (char === "\\") { out += "\\\\"; continue; }
		if (CONTROL_NAMES[codePoint]) { out += `\\x{${CONTROL_NAMES[codePoint]}}`; continue; }
		if ((codePoint >= 0x01 && codePoint <= 0x1f) || (codePoint >= 0x80 && codePoint <= 0x9f)) {
			out += `\\u{${codePoint.toString(16).toUpperCase().padStart(4, "0")}}`;
			continue;
		}
		if (
			/\p{Bidi_Control}/u.test(char) || codePoint === 0x200b || codePoint === 0x200c || codePoint === 0x200d
			|| codePoint === 0x2060 || codePoint === 0xfeff || codePoint === WRAP_MARK.codePointAt(0)
			|| (codePoint >= 0xd800 && codePoint <= 0xdfff)
		) {
			out += `\\u{${codePoint.toString(16).toUpperCase().padStart(4, "0")}}`;
			continue;
		}
		out += char;
	}
	return out;
}

export function decodeCommandAuditText(encoded: string): string {
	const controlCodes = new Map(Object.entries(CONTROL_NAMES).map(([code, name]) => [name, Number(code)]));
	let out = "";
	for (let index = 0; index < encoded.length;) {
		if (encoded[index] !== "\\") {
			const codePoint = encoded.codePointAt(index)!;
			const char = String.fromCodePoint(codePoint);
			out += char;
			index += char.length;
			continue;
		}
		if (encoded[index + 1] === "\\") { out += "\\"; index += 2; continue; }
		const named = /^\\x\{([A-Z0-9]+)\}/.exec(encoded.slice(index));
		if (named && controlCodes.has(named[1])) {
			out += String.fromCodePoint(controlCodes.get(named[1])!);
			index += named[0].length;
			continue;
		}
		const unicode = /^\\u\{([0-9A-F]{4,6})\}/.exec(encoded.slice(index));
		if (unicode) {
			out += String.fromCodePoint(Number.parseInt(unicode[1], 16));
			index += unicode[0].length;
			continue;
		}
		out += "\\";
		index += 1;
	}
	return out;
}
