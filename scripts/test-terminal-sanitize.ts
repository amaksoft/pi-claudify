import assert from "node:assert/strict";

import { sanitizeToolContent, sanitizeToolOutput, sanitizeToolText } from "../extensions/terminal-sanitize.ts";

const ST = "\x1b\\";
const C1_ST = "\x9c";
const envelopes: Array<{ name: string; introducer: string; bel: boolean }> = [
	{ name: "OSC-7bit", introducer: "\x1b]", bel: true },
	{ name: "DCS-7bit", introducer: "\x1bP", bel: false },
	{ name: "SOS-7bit", introducer: "\x1bX", bel: false },
	{ name: "PM-7bit", introducer: "\x1b^", bel: false },
	{ name: "APC-7bit", introducer: "\x1b_", bel: false },
	{ name: "DCS-8bit", introducer: "\x90", bel: false },
	{ name: "SOS-8bit", introducer: "\x98", bel: false },
	{ name: "OSC-8bit", introducer: "\x9d", bel: true },
	{ name: "PM-8bit", introducer: "\x9e", bel: false },
	{ name: "APC-8bit", introducer: "\x9f", bel: false },
];

for (const { name, introducer, bel } of envelopes) {
	for (const terminator of [ST, C1_ST, ...(bel ? ["\x07"] : [])]) {
		assert.equal(sanitizeToolContent(`left${introducer}hidden${terminator}right`), "leftright", `${name} strips a terminated envelope`);
	}
	const unterminated = sanitizeToolContent(`left${introducer}printable`);
	assert.equal(unterminated, "left�printable", `${name} marks an unterminated envelope and preserves readable payload`);
}

const mixed = "a\x1b]osc\x07b\x90dcs\x9cc\x1b_apc\x1b\\d";
assert.equal(sanitizeToolContent(mixed), "abcd", "mixed 7-bit and 8-bit envelopes are consumed independently");
assert.doesNotMatch(sanitizeToolContent(mixed), /[\x1b\x80-\x9f]/, "no terminal envelope controls survive content sanitization");

const divergent = "a\tb\r\nc\rd\u2028e";
assert.equal(sanitizeToolText(divergent), "a b  c d e", "metadata folds row controls to spaces");
assert.equal(sanitizeToolContent(divergent), "a\tb\nc\\rd\\u{2028}e", "content preserves tabs/LF and exposes standalone row controls");
assert.equal(sanitizeToolOutput("a\r\nb\rc"), "a\nb\\rc", "output normalizes CRLF once before per-line content sanitization");

const repeated = "\x1bP".repeat(50_000);
assert.equal(sanitizeToolContent(repeated), "�".repeat(50_000), "many unterminated introducers are handled without suffix rescans");

console.log("terminal sanitizer tests passed");
