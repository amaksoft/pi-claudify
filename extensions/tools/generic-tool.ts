import type { Theme } from "@earendil-works/pi-coding-agent";

import { genericToolLabel, isMcpToolName } from "../host/tool-discovery.ts";
import { summarizeMcpToolCall } from "./mcp-tool.ts";
import { summarizeOpenAiToolCall } from "./openai-tool.ts";

export interface GenericToolRuntime {
	cwd: string;
	syncCallStatus(ctx: any): void;
	stableSummary(ctx: any, key: string, build: () => string): string;
	makeText(last: unknown, text: string): any;
	header(label: string, summary: string, theme: Theme, prefix?: string): string;
	statusDot(ctx: any, theme: Theme): string;
	shortPath(path: string, cwd: string): string;
	summarize(text: string, max: number): string;
	renderMcp(result: any, expanded: boolean, isPartial: boolean, theme: Theme, ctx: any): any;
	renderOpenAi(name: string, result: any, expanded: boolean, isPartial: boolean, theme: Theme, ctx: any): any;
}

export function renderGenericToolCall(runtime: GenericToolRuntime, name: string, args: any, theme: Theme, ctx: any): any {
	runtime.syncCallStatus(ctx);
	ctx.state._openAiPatchFiles = [];
	const shortPath = (path: string) => runtime.shortPath(path, ctx.cwd ?? runtime.cwd);
	const summary = runtime.stableSummary(ctx, ctx.expanded ? "_callSummaryExpanded" : "_callSummary", () =>
		isMcpToolName(name)
			? summarizeMcpToolCall(name, args, theme, ctx.expanded === true, runtime.summarize)
			: summarizeOpenAiToolCall(name, args, theme, shortPath, runtime.summarize),
	);
	return runtime.makeText(ctx.lastComponent, runtime.header(genericToolLabel(name), summary, theme, runtime.statusDot(ctx, theme)));
}

export function renderGenericToolResult(runtime: GenericToolRuntime, name: string, result: any, options: any, theme: Theme, ctx: any): any {
	return isMcpToolName(name)
		? runtime.renderMcp(result, !!options?.expanded, !!options?.isPartial, theme, ctx)
		: runtime.renderOpenAi(name, { content: result.content, details: result.details }, !!options?.expanded, !!options?.isPartial, theme, ctx);
}
