/**
 * Semantic colors observed from live Claude Code captures. These are renderer
 * colors, not a Pi application theme: Pi remains the owner of global UI theme.
 */
export const CLAUDE_PALETTE = {
	accent: {
		dark: { truecolor: "\x1b[38;2;177;185;249m", ansi256: "\x1b[38;5;147m" },
		light: { truecolor: "\x1b[38;2;135;135;255m", ansi256: "\x1b[38;5;105m" },
	},
	status: {
		pending: "\x1b[38;2;153;153;153m",
		success: "\x1b[38;2;135;215;135m",
		error: "\x1b[38;2;255;135;175m",
	},
	statusLight: {
		pending: "\x1b[38;2;98;98;98m",
		success: "\x1b[38;2;95;135;95m",
		error: "\x1b[38;2;175;95;95m",
	},
	gutter: "\x1b[38;2;153;153;153m",
	gutterLight: "\x1b[38;2;98;98;98m",
	inlineCode: "\x1b[38;5;153m",
	link: "\x1b[94m",
	userMessage: {
		background: "\x1b[48;2;58;58;58m",
		prefix: "\x1b[38;2;78;78;78m",
		text: "\x1b[38;2;255;255;255m",
	},
	syntax: {
		keyword: "\x1b[34m",
		type: "\x1b[34m",
		variable: "\x1b[36m",
		function: "\x1b[33m",
		string: "\x1b[31m",
		number: "\x1b[32m",
	},
} as const;
