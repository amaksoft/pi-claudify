import { createBashToolDefinition, type BashToolDetails, type Theme } from "@earendil-works/pi-coding-agent";

import { bashHeaderCommand } from "../bash-preview.ts";
import { classifyBashCommandForDisplay, emptyBashResultLabel } from "../domain/bash-display.ts";
import type { VisualPreviewMode } from "../visual-preview.ts";

export interface BashToolRuntime {
	cwd: string;
	register(definition: any): void;
	forwardContract(definition: any): Record<string, unknown>;
	hostSettings(cwd: string, ctx: any): { shellPath?: string; commandPrefix?: string };
	semanticEnabled(): boolean;
	shortPath(path: string, cwd: string): string;
	syncCallStatus(ctx: any): void;
	stableSummary(ctx: any, key: string, build: () => string): string;
	makeText(last: unknown, text: string): any;
	header(label: string, summary: string, theme: Theme, prefix?: string): string;
	statusDot(ctx: any, theme: Theme): string;
	withBranch(content: string, theme: Theme): string;
	startBlink(ctx: any): void;
	stopBlink(ctx: any): void;
	setStatus(ctx: any, status: "pending" | "success" | "error"): void;
	errorText(theme: Theme, text: string): string;
	widthAware(last: unknown, key: string, build: (width: number) => string[], revision: () => number): any;
	visualPreview(text: string, width: number, rows: number, mode: VisualPreviewMode, theme: Theme, style: "dim" | "error" | "claudeError", options: Record<string, unknown>): string;
	renderLines(text: string, width: number): string[];
	outputMode(): "opencode" | "summary" | "preview";
	runningPreview(): "head" | "tail";
	collapsedLimit(): number;
	collapsedRows(expanded: boolean): number;
	expandedRows(): number;
	revision(): number;
	hash(text: string): string;
}

export function registerBashTool(runtime: BashToolRuntime): void {
	const native = createBashToolDefinition(runtime.cwd);
	runtime.register({
		name: "bash",
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
			const nonEmpty = output.split("\n").filter((line: string) => line.trim().length > 0);
			const semantic = runtime.semanticEnabled() ? classifyBashCommandForDisplay(ctx.args?.command ?? "") : null;
			const prefixNote = (details as any)?._claudifyPrefixApplied ? theme.fg("muted", "Configured shell prefix applied") : "";
			if (isPartial) {
				runtime.startBlink(ctx);
				const running = semantic?.kind === "read" ? "Reading" : "Running";
				const key = `bash-running:${runtime.hash(output)}`;
				return runtime.widthAware(ctx.lastComponent, key, (width) => {
					let text = theme.fg("warning", `${running}... (${nonEmpty.length} lines)`);
					if (nonEmpty.length > 0) text += `\n${runtime.visualPreview(nonEmpty.join("\n"), width, runtime.collapsedLimit(), runtime.runningPreview(), theme, "dim", { laterQualifier: "more" })}`;
					return runtime.renderLines(runtime.withBranch(text, theme), width);
				}, runtime.revision);
			}
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
	});
}
