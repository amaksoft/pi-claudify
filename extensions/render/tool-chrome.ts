import type { SummaryEmphasis } from "../mutation-summary.ts";
import { WRAP_MARK } from "../terminal-sanitize.ts";

export interface ToolTheme {
	fg(key: string, text: string): string;
	bold(text: string): string;
}
export interface ToolChromePalette {
	defaultForeground(): string;
	reset(): string;
	transparentReset(): string;
	rowBackgroundReset(): string;
	pending(): string;
	success(): string;
	error(): string;
	gutter(): string;
	rule(): string;
}
export interface ToolChromeRuntime {
	claudeEnabled(): boolean;
	palette: ToolChromePalette;
	blinkBright(ctx: any): boolean;
}

export function createToolChrome(runtime: ToolChromeRuntime) {
	const setStatus = (ctx: any, status: "pending" | "success" | "error") => { ctx.state._toolStatus = status; };
	const syncCallStatus = (ctx: any) => setStatus(ctx, !ctx?.executionStarted || ctx?.isPartial ? "pending" : ctx.isError ? "error" : "success");
	const shouldRevealArgs = (ctx: any): boolean => {
		if (ctx?.argsComplete === true || ctx?.executionStarted === true) return true;
		const args = ctx?.args;
		return !!args && typeof args === "object" && Object.keys(args).some((key) => args[key] !== undefined && args[key] !== null && args[key] !== "");
	};
	const stableSummary = (ctx: any, key: string, build: () => string, reveal = shouldRevealArgs(ctx)): string => {
		const state = ctx?.state;
		const cached = state?.[key];
		const completeKey = `${key}Complete`;
		if (!reveal) return typeof cached === "string" ? cached : "";
		if (ctx?.argsComplete === true && state?.[completeKey] === true && typeof cached === "string") return cached;
		if (!shouldRevealArgs(ctx) && typeof cached === "string" && cached) return cached;
		const summary = build();
		if (state) { state[key] = summary; if (ctx?.argsComplete === true) state[completeKey] = true; else delete state[completeKey]; }
		return summary;
	};
	const statusDot = (ctx: any, theme: ToolTheme): string => {
		const status = ctx.state?._toolStatus as "pending" | "success" | "error" | undefined;
		if (!runtime.claudeEnabled()) {
			if (status === "error") return `${theme.fg("error", "⏺")} `;
			if (status === "success") return `${theme.fg("accent", "⏺")} `;
			return `${runtime.blinkBright(ctx) ? theme.fg("accent", "⏺") : theme.fg("muted", "⏺")} `;
		}
		const color = status === "error" ? runtime.palette.error() : status === "success" ? runtime.palette.success() : runtime.palette.pending();
		return `${color}⏺${runtime.palette.reset()} `;
	};
	const header = (tool: string, summary: string, theme: ToolTheme, prefix = ""): string => {
		const bg = runtime.palette.rowBackgroundReset();
		if (!runtime.claudeEnabled()) {
			const label = theme.fg("toolTitle", theme.bold(tool));
			return summary ? `${bg}${prefix}${label}${theme.fg("muted", "(")}${WRAP_MARK}${theme.fg("accent", summary)}${theme.fg("muted", ")")}` : `${bg}${prefix}${label}`;
		}
		const label = `${runtime.palette.defaultForeground()}\x1b[1m${tool}\x1b[22m`;
		return summary ? `${bg}${prefix}${label}(${WRAP_MARK}${summary}${runtime.palette.defaultForeground()})${runtime.palette.reset()}` : `${bg}${prefix}${label}${runtime.palette.reset()}`;
	};
	const branchLead = (text: string): string => `${runtime.palette.rowBackgroundReset()}${runtime.claudeEnabled() ? runtime.palette.gutter() : runtime.palette.rule()}  ⎿  ${runtime.palette.transparentReset()}${WRAP_MARK}${text}`;
	const branchIndent = (text: string): string => `${runtime.palette.rowBackgroundReset()}${" ".repeat("  ⎿  ".length)}${WRAP_MARK}${text}`;
	const withBranch = (content: string): string => {
		if (!content || !content.trim()) return "";
		const lines = content.split("\n");
		return [branchLead(lines[0] ?? ""), ...lines.slice(1).map(branchIndent)].join("\n");
	};
	return {
		setStatus,
		syncCallStatus,
		shouldRevealArgs,
		stableSummary,
		statusDot,
		header,
		withBranch,
		emphasis: (): SummaryEmphasis => runtime.claudeEnabled() ? { emphasize: (text) => `\x1b[1m${text}\x1b[22m` } : {},
		resultSentence: (theme: ToolTheme, text: string) => runtime.claudeEnabled() ? `${runtime.palette.defaultForeground()}${text}${runtime.palette.reset()}` : theme.fg("muted", text),
		errorText: (theme: ToolTheme, text: string) => runtime.claudeEnabled() ? `${runtime.palette.error()}${text}${runtime.palette.reset()}` : theme.fg("error", text),
	};
}
