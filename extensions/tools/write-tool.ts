import { createWriteToolDefinition, type Theme } from "@earendil-works/pi-coding-agent";

import { parseDiff, type ParsedDiff } from "../domain/diff-model.ts";
import { languageForPath } from "../domain/language.ts";
import type { ToolPresentationAdapter } from "../domain/tool-presentation.ts";
import { describeWrite, type SummaryEmphasis } from "../mutation-summary.ts";
import { sanitizeToolOutput } from "../terminal-sanitize.ts";
import { executeWriteWithSnapshot } from "./write-execution.ts";
import type { DiffCardRuntime, ToolChromeRuntime } from "./presenter-runtime.ts";

export interface WriteToolPresentationRuntime extends Omit<ToolChromeRuntime, "register" | "registerExecution" | "registerPresentation" | "forwardContract">, DiffCardRuntime {
	summarizeDiff(added: number, removed: number): string;
	linkedPath(path: string, cwd: string): string;
	revealArgs(ctx: any): boolean;
	hasArg(args: any, key: string): boolean;
	withFinalBranch(content: string, theme: Theme): string;
	resultSentence(theme: Theme, text: string): string;
	emphasis(): SummaryEmphasis;
	writtenLineCount(content: string): number;
	renderWidthAwareDiff(last: unknown, key: string, placeholder: string, summary: string, diff: ParsedDiff, language: any, previewLines: number, theme: Theme, invalidate: () => void): any;
	cachedDiff(ctx: any, key: string, oldContent: string, newContent: string): ParsedDiff;
	diffContentWidth(width: number): number;
	claudeDiffPalette(): boolean;
	renderFileListing(content: string, language: any, max: number, width: number): Promise<string>;
	renderUnified(diff: ParsedDiff, language: any, max: number, colors: any, width: number): Promise<string>;
	resolveDiffColors(theme: Theme): any;
	collapsedLimit(): number;
	maxRenderLines: number;
	hash(text: string): string;
	revision(): number;
	diffPresentationEnabled(): boolean;
}

export interface WriteToolRuntime extends WriteToolPresentationRuntime {
	register(definition: any): void;
	registerExecution?: boolean;
	registerPresentation?(presentation: ToolPresentationAdapter): void;
	forwardContract(definition: any): Record<string, unknown>;
}

export function createWriteToolPresentation(runtime: WriteToolPresentationRuntime): ToolPresentationAdapter {
	return {
		name: "write",
		overrideSelfShell: true,
		renderCall(args: any, theme: Theme, ctx: any) {
			const path = args?.path ?? args?.file_path ?? "";
			const reveal = runtime.revealArgs(ctx) || (!!path && runtime.hasArg(args, "content"));
			runtime.syncCallStatus(ctx);
			const summary = runtime.stableSummary(ctx, "_callSummary", () => runtime.linkedPath(path, ctx.cwd ?? runtime.cwd), reveal);
			return runtime.makeText(ctx.lastComponent, runtime.header("Write", summary, theme, runtime.statusDot(ctx, theme)));
		},
		renderResult(result: any, { isPartial }: any, theme: Theme, ctx: any) {
			if (isPartial) {
				runtime.startBlink(ctx);
				return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("dim", "Writing..."), theme));
			}
			runtime.stopBlink(ctx);
			runtime.setStatus(ctx, ctx.isError ? "error" : "success");
			if (ctx.isError) {
				const error = result.content?.filter((item: any) => item.type === "text").map((item: any) => item.text || "").join("\n") ?? "Error";
				return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("error", sanitizeToolOutput(error)), theme));
			}
			if (!runtime.diffPresentationEnabled()) return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("success", "Written"), theme));
			const details = result.details;
			if (details?._type === "diff" && details.diff?.lines) {
				const previewLines = ctx.expanded ? runtime.maxRenderLines : runtime.collapsedLimit();
				const summary = runtime.resultSentence(theme, describeWrite(runtime.writtenLineCount(ctx.args?.content ?? ""), runtime.linkedPath(ctx.args?.path ?? ctx.args?.file_path ?? "", ctx.cwd ?? runtime.cwd), runtime.emphasis()));
				const key = `write:${runtime.hash(JSON.stringify(details.diff))}:${details.language ?? ""}:${ctx.expanded ? 1 : 0}:${runtime.revision()}`;
				return runtime.renderWidthAwareDiff(ctx.lastComponent, key, runtime.withFinalBranch(`${summary}\n${theme.fg("muted", "rendering diff…")}`, theme), summary, details.diff, details.language, previewLines, theme, ctx.invalidate);
			}
			if (details?._type === "noChange") return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("muted", "✓ no changes"), theme));
			if (details?._type === "diffOmitted") {
				const summary = runtime.resultSentence(theme, describeWrite(runtime.writtenLineCount(ctx.args?.content ?? ""), runtime.linkedPath(details.filePath ?? "", ctx.cwd ?? runtime.cwd), runtime.emphasis()));
				const reason = details.reason === "oversized" ? "diff omitted: file too large" : "diff omitted: source unavailable";
				return runtime.makeText(ctx.lastComponent, runtime.withBranch(`${summary} ${theme.fg("muted", `(${reason})`)}`, theme));
			}
			if (details?._type === "new") {
				const content = typeof ctx.args?.content === "string" ? ctx.args.content : "";
				const lineTotal = runtime.writtenLineCount(content);
				const contentHash = runtime.hash(content);
				const syntheticDiff = runtime.cachedDiff(ctx, `nf-diff:${details.filePath}:${contentHash}`, "", content);
				const summary = runtime.resultSentence(theme, describeWrite(lineTotal, runtime.linkedPath(details.filePath ?? "", ctx.cwd ?? runtime.cwd), runtime.emphasis()));
				const previewLines = ctx.expanded ? runtime.maxRenderLines : runtime.collapsedLimit();
				const language = languageForPath(details.filePath);
				const key = `new-file:${details.filePath}:${contentHash}:${ctx.expanded ? 1 : 0}:${runtime.revision()}`;
				return runtime.diffCard(
					ctx.lastComponent,
					key,
					runtime.withFinalBranch(`${summary}\n${theme.fg("muted", "rendering diff…")}`, theme),
					async (width) => {
						const bodyWidth = runtime.diffContentWidth(width);
						const rendered = runtime.claudeDiffPalette()
							? await runtime.renderFileListing(content, language, previewLines, bodyWidth)
							: await runtime.renderUnified(syntheticDiff, language, previewLines, runtime.resolveDiffColors(theme), bodyWidth);
						return runtime.withFinalBranch(`${summary}\n${rendered}`, theme);
					},
					ctx.invalidate,
					runtime.renderPrewrapped,
					runtime.withBranch(summary, theme),
				);
			}
			return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("success", "Written"), theme));
		},
	};
}

export function registerWriteTool(runtime: WriteToolRuntime): void {
	const presentation = createWriteToolPresentation(runtime);
	runtime.registerPresentation?.(presentation);
	if (runtime.registerExecution === false) return;
	const native = createWriteToolDefinition(runtime.cwd);
	runtime.register({
		label: "write",
		description: native.description,
		parameters: native.parameters,
		...runtime.forwardContract(native),
		execute: (toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) =>
			executeWriteWithSnapshot(runtime.cwd, toolCallId, params, signal, onUpdate, ctx, { summarizeDiff: runtime.summarizeDiff, isDiffPresentationEnabled: () => runtime.diffPresentationEnabled() }),
		...presentation,
	});
}
