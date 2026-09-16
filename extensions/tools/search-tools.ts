import {
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	type GrepToolDetails,
	type Theme,
} from "@earendil-works/pi-coding-agent";

import { buildSearchCallView, buildTextResultView, type SearchToolName } from "../domain/tool-view.ts";
import { dirIcon, fileIcon } from "../render/file-icons.ts";
import { selectVisualItems } from "../visual-preview.ts";

export interface SearchToolRuntime {
	cwd: string;
	register(definition: any): void;
	forwardContract(definition: any): Record<string, unknown>;
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
	widthAware(last: unknown, key: string, build: (width: number) => string[], revision: () => number): any;
	renderLines(text: string, width: number): string[];
	visualPreview(text: string, width: number, rows: number, theme: Theme): string;
	expandedLimit(): number;
	revision(): number;
	hash(text: string): string;
	fgRule: () => string;
	reset: () => string;
}

function nativeDefinition(kind: SearchToolName, cwd: string): any {
	if (kind === "grep") return createGrepToolDefinition(cwd);
	if (kind === "find") return createFindToolDefinition(cwd);
	return createLsToolDefinition(cwd);
}

function definitionFor(kind: SearchToolName, runtime: SearchToolRuntime): any {
	const native = nativeDefinition(kind, runtime.cwd);
	return {
		name: kind,
		label: kind,
		description: native.description,
		parameters: native.parameters,
		...runtime.forwardContract(native),
		async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
			const cwd = ctx?.cwd ?? runtime.cwd;
			return nativeDefinition(kind, cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args: any, theme: Theme, ctx: any) {
			runtime.syncCallStatus(ctx);
			const view = buildSearchCallView(kind, args, (path) => runtime.shortPath(path, ctx.cwd ?? runtime.cwd));
			const summary = runtime.stableSummary(ctx, "_callSummary", () => view.summary);
			return runtime.makeText(ctx.lastComponent, runtime.header(view.label, summary, theme, runtime.statusDot(ctx, theme)));
		},
		renderResult(result: any, { expanded, isPartial }: any, theme: Theme, ctx: any) {
			const view = buildSearchCallView(kind, ctx.args, (path) => runtime.shortPath(path, ctx.cwd ?? runtime.cwd));
			if (isPartial) {
				runtime.startBlink(ctx);
				return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("dim", view.pendingLabel), theme));
			}
			runtime.stopBlink(ctx);
			runtime.setStatus(ctx, ctx.isError ? "error" : "success");
			const { items, raw } = buildTextResultView(result);
			if (items.length === 0) return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("muted", view.emptyLabel), theme));
			let text = theme.fg("muted", `${items.length} ${view.itemNoun}`);
			if (kind === "grep" && (result.details as GrepToolDetails | undefined)?.truncation?.truncated) {
				text += theme.fg("warning", " (truncated)");
			}
			if (!expanded) return runtime.makeText(ctx.lastComponent, runtime.withBranch(`${text}${theme.fg("muted", " (ctrl+o to expand)")}`, theme));
			const key = `${kind}-expanded:${runtime.hash(raw)}`;
			return runtime.widthAware(ctx.lastComponent, key, (width) => {
				if (kind === "grep") {
					const preview = runtime.visualPreview(raw, width, runtime.expandedLimit(), theme);
					return runtime.renderLines(runtime.withBranch(`${text}\n${preview}`, theme), width);
				}
				const selected = selectVisualItems(items, (item) => kind === "find" ? item.trim() : item, Math.max(10, width - (kind === "find" ? 10 : 12)), runtime.expandedLimit());
				const rows = kind === "find"
					? selected.rows.map((row) => row.continuation
						? `    ${theme.fg("dim", row.text)}`
						: `  ${fileIcon(row.item.trim())}${theme.fg("dim", row.text)}`)
					: selected.rows.map((row, index) => {
						if (row.continuation) return `${runtime.fgRule()}│${runtime.reset()}    ${theme.fg("dim", row.text)}`;
						const isDirectory = row.item.endsWith("/");
						const isLast = index === selected.rows.length - 1 && selected.hiddenItems === 0;
						const prefix = isLast ? `${runtime.fgRule()}└──${runtime.reset()} ` : `${runtime.fgRule()}├──${runtime.reset()} `;
						const icon = isDirectory ? dirIcon() : fileIcon(row.item);
						const name = isDirectory ? theme.fg("accent", theme.bold(row.text)) : theme.fg("dim", row.text);
						return `${prefix}${icon}${name}`;
					});
				if (selected.hiddenItems > 0) {
					rows.push(kind === "find"
						? `  ${theme.fg("muted", `… ${selected.hiddenItems} more files`)}`
						: `${runtime.fgRule()}└──${runtime.reset()} ${theme.fg("muted", `… ${selected.hiddenItems} more entries`)}`);
				}
				return runtime.renderLines(runtime.withBranch(`${text}\n${rows.join("\n")}`, theme), width);
			}, runtime.revision);
		},
	};
}

export function registerSearchTools(runtime: SearchToolRuntime): void {
	for (const kind of ["grep", "find", "ls"] as const) runtime.register(definitionFor(kind, runtime));
}
