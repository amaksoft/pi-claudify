import { createBashToolDefinition, type BashToolDetails, type Theme } from "@earendil-works/pi-coding-agent";

import { bashHeaderCommand } from "../bash-preview.ts";
import { classifyBashCommandForDisplay, emptyBashResultLabel } from "../domain/bash-display.ts";
import type { ToolPresentationAdapter } from "../domain/tool-presentation.ts";
import type { VisualPreviewMode } from "../visual-preview.ts";
import type { WidthAwareToolRuntime } from "./presenter-runtime.ts";

export interface BashToolRuntime extends WidthAwareToolRuntime {
	hostSettings(cwd: string, ctx: any): { shellPath?: string; commandPrefix?: string };
	semanticEnabled(): boolean;
	shortPath(path: string, cwd: string): string;
	errorText(theme: Theme, text: string): string;
	visualPreview(text: string, width: number, rows: number, mode: VisualPreviewMode, theme: Theme, style: "dim" | "error" | "claudeError", options: Record<string, unknown>): string;
	outputMode(): "opencode" | "summary" | "preview";
	runningPreview(): "head" | "tail";
	collapsedLimit(): number;
	collapsedRows(expanded: boolean): number;
	expandedRows(): number;
}

export type BashToolPresentationRuntime = Omit<BashToolRuntime, "register" | "registerExecution" | "registerPresentation" | "forwardContract" | "hostSettings">;

/** Streaming preview bounds: per-partial work stays proportional to new output. */
const RUNNING_PREVIEW_QUANTUM = 8 * 1024;
const RUNNING_PREVIEW_MAX_CHARS = 64 * 1024;
const RUNNING_COUNT_PROBE = 32;

interface BashRunningCount {
	length: number;
	consumed: number;
	count: number;
	pendingEmpty: boolean;
	probe: string;
}

interface BashRunningPreviewCache {
	bucket: number;
	revision: number;
	width: number;
	mode: VisualPreviewMode;
	limit: number;
	theme: unknown;
	text: string;
}

function isBlankText(text: string): boolean {
	return /^\s*$/.test(text);
}

/** Exact non-empty line count in a single pass without retaining a line array. */
function fullNonEmptyLineCount(output: string): { count: number; consumed: number } {
	let count = 0;
	let lineStart = 0;
	while (true) {
		const newline = output.indexOf("\n", lineStart);
		if (newline === -1) break;
		if (output.slice(lineStart, newline).trim().length > 0) count++;
		lineStart = newline + 1;
	}
	return { count, consumed: lineStart };
}

/**
 * Incremental non-empty line counter for streaming output. Streaming partials
 * arrive append-only, so only the pending fragment plus new bytes are scanned;
 * any shrink or prefix rewrite falls back to a full single-pass count.
 */
function countRunningLines(ctx: any, output: string): number {
	const state = ctx?.state;
	const prev = state?._bashRunningLines as BashRunningCount | undefined;
	if (state && prev && output.length >= prev.length && output.slice(0, prev.probe.length) === prev.probe) {
		let count = prev.count;
		let lineStart = prev.consumed;
		while (true) {
			const newline = output.indexOf("\n", lineStart);
			if (newline === -1) break;
			if (output.slice(lineStart, newline).trim().length > 0) count++;
			lineStart = newline + 1;
		}
		const pendingEmpty = lineStart === prev.consumed
			? prev.pendingEmpty && isBlankText(output.slice(prev.length))
			: isBlankText(output.slice(lineStart));
		state._bashRunningLines = { length: output.length, consumed: lineStart, count, pendingEmpty, probe: output.slice(0, RUNNING_COUNT_PROBE) };
		return count + (pendingEmpty ? 0 : 1);
	}
	const { count, consumed } = fullNonEmptyLineCount(output);
	const pendingEmpty = isBlankText(output.slice(consumed));
	if (state) state._bashRunningLines = { length: output.length, consumed, count, pendingEmpty, probe: output.slice(0, RUNNING_COUNT_PROBE) };
	return count + (pendingEmpty ? 0 : 1);
}

/**
 * Bounds the text handed to the running preview. Small outputs pass through
 * untouched; larger ones are windowed to the visible end so a streaming
 * multi-megabyte output costs a constant per refresh, not a full re-scan.
 */
function runningPreviewInput(output: string, mode: VisualPreviewMode): string {
	if (output.length <= RUNNING_PREVIEW_MAX_CHARS) return output;
	if (mode === "tail") {
		const window = output.slice(-RUNNING_PREVIEW_MAX_CHARS);
		const newline = window.indexOf("\n");
		return newline === -1 ? window : window.slice(newline + 1);
	}
	const window = output.slice(0, RUNNING_PREVIEW_MAX_CHARS);
	const newline = window.lastIndexOf("\n");
	return newline === -1 ? window : window.slice(0, newline);
}

/**
 * Throttled running preview: the preview text refreshes at most once per
 * output quantum (plus mode/limit/width/theme changes) while the line count
 * in the header stays exact via the incremental counter.
 */
function cachedRunningPreview(ctx: any, runtime: BashToolPresentationRuntime, output: string, bucket: number, revision: number, width: number, limit: number, mode: VisualPreviewMode, theme: Theme): string {
	const state = ctx?.state;
	const prev = state?._bashRunningPreview as BashRunningPreviewCache | undefined;
	if (prev && prev.bucket === bucket && prev.revision === revision && prev.width === width && prev.mode === mode && prev.limit === limit && prev.theme === theme) return prev.text;
	const text = runtime.visualPreview(
		runningPreviewInput(output, mode).split("\n").filter((line: string) => line.trim().length > 0).join("\n"),
		width, limit, mode, theme, "dim", { laterQualifier: "more" });
	if (state) state._bashRunningPreview = { bucket, revision, width, mode, limit, theme, text };
	return text;
}

/** Creates the Bash renderer without coupling it to a schema or execution. */
export function createBashToolPresentation(runtime: BashToolPresentationRuntime) {
	return {
		name: "bash",
		overrideSelfShell: true,
		renderCall(args: any, theme: Theme, ctx: any) {
			runtime.syncCallStatus(ctx);
			const semantic = runtime.semanticEnabled() ? classifyBashCommandForDisplay(args.command ?? "") : null;
			const summary = runtime.stableSummary(ctx, ctx.expanded ? "_callSummaryExpanded" : "_callSummary", () => {
				if (!semantic || ctx.expanded === true) return bashHeaderCommand(args.command, ctx.expanded === true);
				const path = runtime.shortPath(semantic.path, ctx.cwd ?? runtime.cwd);
				return semantic.rangeLabel ? `${path} ${theme.fg("muted", `(${semantic.rangeLabel})`)}` : path;
			});
			return runtime.makeText(ctx.lastComponent, runtime.header(semantic?.label ?? "Bash", summary, theme, runtime.statusDot(ctx, theme)));
		},
		renderResult(result: any, { expanded, isPartial }: any, theme: Theme, ctx: any) {
			const details = result.details as BashToolDetails | undefined;
			const rawOutput: string = result.content[0]?.type === "text" ? result.content[0].text : "";
			const output = !ctx.isError && rawOutput.trim() === "(no output)" ? "" : rawOutput;
			const semantic = runtime.semanticEnabled() ? classifyBashCommandForDisplay(ctx.args?.command ?? "") : null;
			const prefixNote = (details as any)?._claudifyPrefixApplied ? theme.fg("muted", "Configured shell prefix applied") : "";
			if (isPartial) {
				runtime.startBlink(ctx);
				const running = semantic?.kind === "read" ? "Reading" : "Running";
				const lineCount = countRunningLines(ctx, output);
				const previewMode = runtime.runningPreview();
				const previewLimit = runtime.collapsedLimit();
				const previewRevision = runtime.revision();
				const bucket = Math.floor(output.length / RUNNING_PREVIEW_QUANTUM);
				const key = `bash-running:${bucket}:${lineCount}:${previewMode}:${previewLimit}:${previewRevision}`;
				return runtime.widthAware(ctx.lastComponent, key, (width) => {
					// Read live inside the rebuild: a settings change bumps revision and
					// re-renders this cached row without re-invoking renderResult, so the
					// build must not pin the mode/limit captured above (else tail stays head).
					const liveMode = runtime.runningPreview();
					const liveLimit = runtime.collapsedLimit();
					const liveRevision = runtime.revision();
					const liveBucket = Math.floor(output.length / RUNNING_PREVIEW_QUANTUM);
					let text = theme.fg("warning", `${running}... (${lineCount} lines)`);
					if (lineCount > 0) text += `\n${cachedRunningPreview(ctx, runtime, output, liveBucket, liveRevision, width, liveLimit, liveMode, theme)}`;
					return runtime.renderLines(runtime.withBranch(text, theme), width);
				}, runtime.revision);
			}
			const nonEmpty = output.split("\n").filter((line: string) => line.trim().length > 0);
			runtime.stopBlink(ctx);
			runtime.setStatus(ctx, ctx.isError ? "error" : "success");
			const exitMatch = output.match(/(?:exit code:|exited with code)\s+(\d+)/i);
			const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : null;
			const isError = ctx.isError || (exitCode !== null && exitCode !== 0);
			let text = isError
				? runtime.errorText(theme, exitCode !== null ? `Exit ${exitCode}` : "Failed")
				: semantic?.kind === "read"
					? `${theme.fg("success", "Read")} ${theme.fg("muted", `${nonEmpty.length} line${nonEmpty.length === 1 ? "" : "s"}`)}`
					: `${theme.fg("success", "Done")}${theme.fg("muted", ` (${nonEmpty.length} lines)`)}`;
			if (details?.truncation?.truncated) text += theme.fg("warning", " [truncated]");
			const mode = runtime.outputMode();
			if (mode === "summary") return runtime.makeText(ctx.lastComponent, runtime.withBranch(text, theme));
			if (mode === "preview") {
				if (nonEmpty.length === 0) return runtime.makeText(ctx.lastComponent, runtime.withBranch(text, theme));
				const key = `bash-preview:${runtime.hash(output)}:${expanded ? 1 : 0}`;
				return runtime.widthAware(ctx.lastComponent, key, (width) => {
					const preview = runtime.visualPreview(nonEmpty.join("\n"), width, runtime.collapsedRows(expanded), "head", theme, isError ? "error" : "dim", { expandHint: !expanded, expandedCap: expanded });
					const body = expanded && prefixNote ? `${prefixNote}\n${text}\n${preview}` : `${text}\n${preview}`;
					return runtime.renderLines(runtime.withBranch(body, theme), width);
				}, runtime.revision);
			}
			if (!expanded && nonEmpty.length > 0) {
				const hint = semantic?.suppressCollapsedHint ? "" : theme.fg("muted", " (ctrl+o to expand)");
				return runtime.makeText(ctx.lastComponent, runtime.withBranch(`${text}${hint}`, theme));
			}
			if (!expanded) return runtime.makeText(ctx.lastComponent, runtime.withBranch(text, theme));
			if (nonEmpty.length === 0) {
				const emptyLabel = theme.fg("muted", emptyBashResultLabel(ctx.args?.command ?? ""));
				return runtime.makeText(ctx.lastComponent, runtime.withBranch(prefixNote ? `${prefixNote}\n${emptyLabel}` : emptyLabel, theme));
			}
			const key = `bash-expanded:${runtime.hash(output)}`;
			return runtime.widthAware(ctx.lastComponent, key, (width) => {
				const preview = runtime.visualPreview(nonEmpty.join("\n"), width, runtime.expandedRows(), "head", theme, isError ? "claudeError" : "dim", { expandedCap: true });
				let body = isError || semantic?.kind === "read" || details?.truncation?.truncated ? `${text}\n${preview}` : preview;
				if (prefixNote) body = `${prefixNote}\n${body}`;
				return runtime.renderLines(runtime.withBranch(body, theme), width);
			}, runtime.revision);
		},
	} satisfies ToolPresentationAdapter;
}

export function registerBashTool(runtime: BashToolRuntime): void {
	const presentation = createBashToolPresentation(runtime);
	runtime.registerPresentation?.(presentation);
	if (runtime.registerExecution === false) return;
	const native = createBashToolDefinition(runtime.cwd);
	runtime.register({
		label: "bash",
		description: native.description,
		parameters: native.parameters,
		...runtime.forwardContract(native),
		async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
			const cwd = ctx?.cwd ?? runtime.cwd;
			const { shellPath, commandPrefix } = runtime.hostSettings(cwd, ctx);
			const result = await createBashToolDefinition(cwd, { shellPath, commandPrefix }).execute(toolCallId, params, signal, onUpdate, ctx);
			(result as any).details = { ...((result as any).details ?? {}), _claudifyPrefixApplied: !!commandPrefix };
			return result;
		},
		...presentation,
	});
}
