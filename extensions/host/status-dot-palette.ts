import { CLAUDE_PALETTE } from "../claude-palette.ts";
import { safeFgAnsi } from "./theme-access.ts";

// Status colors read off Claude Code's raw TTY stream. The bullet is the trust
// signal: gray while the tool runs, green once it actually succeeded.
let ccDotPending: string = CLAUDE_PALETTE.status.pending;
// Fresh Claude Code v2.1.266 dark capture: xterm 114 (#87D787) success,
// xterm 211 (#FF87AF) error. Diff-removal red is a separate semantic color.
let ccDotSuccess: string = CLAUDE_PALETTE.status.success;
let ccDotError: string = CLAUDE_PALETTE.status.error;
let ccGutterFg: string = CLAUDE_PALETTE.gutter;

export function getStatusDotPending(): string {
	return ccDotPending;
}

export function getStatusDotSuccess(): string {
	return ccDotSuccess;
}

export function getStatusDotError(): string {
	return ccDotError;
}

export function getStatusGutterForeground(): string {
	return ccGutterFg;
}

/** Re-derives the tool-status bullet/gutter colors for the active theme polarity. */
export function applyStatusDotPalette(theme: unknown, polarity: "dark" | "light" | "unknown"): void {
	if (polarity === "unknown") {
		ccDotPending = safeFgAnsi(theme, "muted") ?? CLAUDE_PALETTE.status.pending;
		ccDotSuccess = safeFgAnsi(theme, "success") ?? CLAUDE_PALETTE.status.success;
		ccDotError = safeFgAnsi(theme, "error") ?? CLAUDE_PALETTE.status.error;
		ccGutterFg = safeFgAnsi(theme, "muted") ?? CLAUDE_PALETTE.gutter;
		return;
	}
	const light = polarity === "light";
	ccDotPending = light ? CLAUDE_PALETTE.statusLight.pending : CLAUDE_PALETTE.status.pending;
	ccDotSuccess = light ? CLAUDE_PALETTE.statusLight.success : CLAUDE_PALETTE.status.success;
	ccDotError = light ? CLAUDE_PALETTE.statusLight.error : CLAUDE_PALETTE.status.error;
	ccGutterFg = light ? CLAUDE_PALETTE.gutterLight : CLAUDE_PALETTE.gutter;
}
