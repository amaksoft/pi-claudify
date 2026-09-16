import { createReadToolDefinition, type ReadToolDetails, type Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeToolText } from "../terminal-sanitize.ts";
import type { WidthAwareToolRuntime } from "./presenter-runtime.ts";

export interface ReadToolRuntime extends WidthAwareToolRuntime {
	autoResizeImages(cwd: string, ctx: any): boolean;
	linkedPath(path: string, cwd: string): string;
	firstImage(result: any): unknown;
	renderImage(result: any, expanded: boolean, theme: Theme, ctx: any): any;
	errorText(theme: Theme, text: string): string;
	formatReadCount(theme: Theme, count: number): string;
	visualPreview(text: string, width: number, rows: number, mode: "dim" | "claudeError", theme: Theme, expanded: boolean): string;
	collapsedRows(expanded: boolean): number;
	expandedRows(): number;
}

export function registerReadTool(runtime: ReadToolRuntime): void {
	const native = createReadToolDefinition(runtime.cwd);
	runtime.register({
		name: "read",
		label: "read",
		description: native.description,
		parameters: native.parameters,
		...runtime.forwardContract(native),
		async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
			const cwd = ctx?.cwd ?? runtime.cwd;
			return createReadToolDefinition(cwd, { autoResizeImages: runtime.autoResizeImages(cwd, ctx) })
				.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args: any, theme: Theme, ctx: any) {
			runtime.syncCallStatus(ctx);
			const summary = runtime.stableSummary(ctx, "_callSummary", () => {
				let value = runtime.linkedPath(args.path ?? "", ctx.cwd ?? runtime.cwd);
				const parts: string[] = [];
				if (args.offset) parts.push(`offset=${sanitizeToolText(args.offset)}`);
				if (args.limit) parts.push(`limit=${sanitizeToolText(args.limit)}`);
				if (parts.length > 0) value += ` ${theme.fg("muted", `(${parts.join(", ")})`)}`;
				return value;
			});
			return runtime.makeText(ctx.lastComponent, runtime.header("Read", summary, theme, runtime.statusDot(ctx, theme)));
		},
		renderResult(result: any, { expanded, isPartial }: any, theme: Theme, ctx: any) {
			if (isPartial) {
				runtime.startBlink(ctx);
				return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("dim", "Reading..."), theme));
			}
			runtime.stopBlink(ctx);
			runtime.setStatus(ctx, ctx.isError ? "error" : "success");
			if (runtime.firstImage(result)) return runtime.renderImage(result, expanded, theme, ctx);
			const details = result.details as ReadToolDetails | undefined;
			const content = result.content.find((block: any) => block?.type === "text");
			if (content?.type !== "text") return runtime.makeText(ctx.lastComponent, runtime.withBranch(runtime.errorText(theme, "No text content"), theme));
			const lines = content.text.split("\n");
			if (ctx.isError) {
				const key = `read-error:${runtime.hash(content.text)}:${expanded ? 1 : 0}`;
				return runtime.widthAware(ctx.lastComponent, key, (width) => {
					const preview = runtime.visualPreview(content.text, width, runtime.collapsedRows(expanded), "claudeError", theme, expanded);
					return runtime.renderLines(runtime.withBranch(preview || runtime.errorText(theme, "No text content"), theme), width);
				}, runtime.revision);
			}
			let text = runtime.formatReadCount(theme, lines.length);
			if (details?.truncation?.truncated) text += theme.fg("warning", " (truncated)");
			if (!expanded) return runtime.makeText(ctx.lastComponent, runtime.withBranch(`${text}${theme.fg("muted", " (ctrl+o to expand)")}`, theme));
			const key = `read-expanded:${runtime.hash(content.text)}`;
			return runtime.widthAware(ctx.lastComponent, key, (width) => {
				const preview = runtime.visualPreview(content.text, width, runtime.expandedRows(), "dim", theme, true);
				return runtime.renderLines(runtime.withBranch(`${text}\n${preview}`, theme), width);
			}, runtime.revision);
		},
	});
}
