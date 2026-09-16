import type { Theme } from "@earendil-works/pi-coding-agent";

import { getStringArg, getTextContent } from "../domain/tool-arguments.ts";
import { mcpOriginalName, mcpToolServer } from "../host/tool-discovery.ts";
import { mcpCallArgsText } from "../mcp-presentation.ts";
import { toolComponentRecord } from "../pi-tool-adapter.ts";
import { sanitizeToolOutput, sanitizeToolText } from "../terminal-sanitize.ts";

export interface McpToolRuntime {
	makeText(last: unknown, text: string): any;
	withBranch(content: string, theme: Theme): string;
	startBlink(ctx: any): void;
	stopBlink(ctx: any): void;
	setStatus(ctx: any, status: "pending" | "success" | "error"): void;
	outputMode(): "hidden" | "summary" | "preview";
	buildPreview(lines: string[], expanded: boolean, theme: Theme, collapsedRows: number): string;
	previewRows(): number;
	resultSentence(theme: Theme, text: string): string;
	plural(count: number, noun: string): string;
	summarize(text: string, max: number): string;
}

function serverFromQualifiedName(qualified: string): string {
	const boundary = qualified.indexOf("_");
	return boundary <= 0 ? "" : qualified.slice(0, boundary);
}

export function mcpServerName(toolName: unknown, args: any): string {
	const safe = (value: unknown): string => sanitizeToolText(value).trim();
	const name = typeof toolName === "string" ? toolName : "";
	const registered = mcpToolServer(name);
	if (registered) return safe(registered);
	const qualified = /^mcp__(.+?)__/.exec(name);
	if (qualified) return safe(qualified[1]);
	const explicit = getStringArg(args, "server", "connect");
	if (explicit) return safe(explicit);
	const operand = getStringArg(args, "tool", "describe");
	return operand ? safe(serverFromQualifiedName(operand)) : "";
}

export function mcpServerForComponent(value: unknown): string {
	const record = toolComponentRecord(value);
	if (typeof record._ccMcpServer === "string" && record._ccMcpServer) return record._ccMcpServer;
	const stamped = record.result?.details?.server;
	const resolved = sanitizeToolText(typeof stamped === "string" && stamped ? stamped : mcpServerName(record.toolName, record.args)).trim();
	if (resolved) record._ccMcpServer = resolved;
	return resolved;
}

export function summarizeMcpToolCall(name: string, args: any, theme: Theme, expanded: boolean, summarize: (text: string, max: number) => string): string {
	const server = mcpServerName(name, args);
	const params = expanded ? mcpCallArgsText(name, args) : "";
	const withParams = (head: string): string => {
		const safeHead = sanitizeToolText(head);
		return params ? `${safeHead} ${theme.fg("muted", params)}` : safeHead;
	};
	if (name !== "mcp") {
		const original = mcpOriginalName(name) ?? name;
		return withParams(server ? `${server}:${original}` : original);
	}
	const tool = getStringArg(args, "tool", "describe");
	if (tool) {
		const bare = server && tool.startsWith(`${server}_`) ? tool.slice(server.length + 1) : tool;
		return withParams(server ? `${server}:${bare}` : bare);
	}
	const other = getStringArg(args, "connect", "search", "action", "server");
	return other ? summarize(other, 72) : theme.fg("muted", "status");
}

export function renderMcpToolResult(
	runtime: McpToolRuntime,
	result: any,
	expanded: boolean,
	isPartial: boolean,
	theme: Theme,
	ctx: any,
): any {
	if (isPartial) {
		runtime.startBlink(ctx);
		return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("dim", "MCP running..."), theme));
	}
	runtime.stopBlink(ctx);
	runtime.setStatus(ctx, ctx.isError ? "error" : "success");
	const mode = runtime.outputMode();
	if (mode === "hidden") return runtime.makeText(ctx.lastComponent, "");
	const raw = sanitizeToolOutput(getTextContent(result)).trim();
	const lines = raw ? raw.split("\n") : [];
	if (lines.length === 0) return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg(ctx.isError ? "error" : "success", ctx.isError ? "Failed" : "Done"), theme));
	if (mode === "summary") {
		const status = ctx.isError ? theme.fg("error", lines[0]) : runtime.resultSentence(theme, `${runtime.plural(lines.length, "line")} returned`);
		return runtime.makeText(ctx.lastComponent, runtime.withBranch(status, theme));
	}
	const tone = ctx.isError ? "error" : "toolOutput";
	const preview = runtime.buildPreview(lines.map((line) => theme.fg(tone, line || " ")), expanded, theme, runtime.previewRows());
	return runtime.makeText(ctx.lastComponent, runtime.withBranch(preview, theme));
}
