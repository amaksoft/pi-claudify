// ---------------------------------------------------------------------------
// Pure text/ANSI helpers shared by the composition root's global tool-border
// patch and message policy: stripping SGR escapes, detecting blank lines,
// detecting terminal image protocol payloads (Kitty/iTerm2), and normalizing
// the leading check glyph Pi's host renderer emits for settled tool rows.
//
// This domain/ module must not import Pi host packages or perform host I/O
// (enforced by scripts/test-architecture-boundaries.ts).
// ---------------------------------------------------------------------------

export const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const ANSI_PRESENT_RE = /\x1b\[[0-9;]*m/;

export const KITTY_IMAGE_PREFIX = "\x1b_G";
export const ITERM2_IMAGE_PREFIX = "\x1b]1337;File=";

export function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

export function isBlankLine(text: string): boolean {
	return stripAnsi(text).trim().length === 0;
}

export function isTerminalImageLine(line: string): boolean {
	return line.includes(KITTY_IMAGE_PREFIX) || line.includes(ITERM2_IMAGE_PREFIX);
}

/**
 * Pi's host renderer marks a settled read-only tool with a leading ✓/✔; Claude
 * chrome uses a single dot glyph for every settled status instead.
 */
export function normalizeLeadingCheckGlyph(line: string): string {
	return line.replace(/^((?:\x1b\[[0-9;]*m|[ \t])*)[✓✔](?=\s)/, "$1●");
}

function firstImageBlockStart(lines: string[]): number {
	const imageLineIndex = lines.findIndex(isTerminalImageLine);
	if (imageLineIndex === -1) return -1;
	let start = imageLineIndex;
	while (start > 0 && isBlankLine(lines[start - 1])) start--;
	return start;
}

export function splitRenderedImageBlock(lines: string[]): { textLines: string[]; imageLines: string[] } {
	const imageStart = firstImageBlockStart(lines);
	if (imageStart === -1) return { textLines: lines, imageLines: [] };
	const textLines = lines.slice(0, imageStart);
	while (textLines.length > 0 && isBlankLine(textLines[textLines.length - 1])) textLines.pop();
	return { textLines, imageLines: lines.slice(imageStart) };
}
