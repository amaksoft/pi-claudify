import type { Theme } from "@earendil-works/pi-coding-agent";

import {
	buildApplyPatchResultMeta,
	parseApplyPatchPreview,
	type ApplyPatchChangePreview,
	type ApplyPatchPreview,
	type ApplyPatchResultMeta,
} from "../domain/apply-patch.ts";
import { getRawStringArg, getTextContent } from "../domain/tool-arguments.ts";
import { sanitizeToolOutput } from "../terminal-sanitize.ts";

export interface ApplyPatchRuntime {
	syncCallStatus(ctx: any): void;
	stableSummary(ctx: any, key: string, build: () => string): string;
	makeText(last: unknown, text: string): any;
	header(label: string, summary: string, theme: Theme, prefix?: string): string;
	statusDot(ctx: any, theme: Theme): string;
	withBranch(content: string, theme: Theme, isError?: boolean, continued?: boolean): string;
	startBlink(ctx: any): void;
	stopBlink(ctx: any): void;
	setStatus(ctx: any, status: "pending" | "success" | "error"): void;
	displayPath(path: string, moveTo?: string): string;
	language(path: string): any;
	summarizeDiff(added: number, removed: number): string;
	summarizeCall(args: any, theme: Theme, shortPath: (path: string) => string): string;
	branchWidth(): number;
	resolveDiffColors(theme: Theme): any;
	renderSplit(diff: any, language: any, maxRows: number, colors: any, width: number): Promise<string>;
	diffSummaryWithMeta(added: number, removed: number, hunks: number, mode: string): string;
	maxPreviewLines: number;
	maxRenderLines: number;
	hash(text: string): string;
	diffPresentationEnabled(): boolean;
}

function describe(change: ApplyPatchChangePreview): string {
	if (change.moveTo) return `Rename ${change.displayPath}`;
	if (change.kind === "add") return `Create ${change.displayPath}`;
	if (change.kind === "delete") return `Delete ${change.displayPath}`;
	return `Update ${change.displayPath}`;
}
function lineMeta(line: number, theme: Theme): string { return line > 0 ? ` ${theme.fg("muted", `at line ${line}`)}` : ""; }

function cachedPreview(runtime: ApplyPatchRuntime, patchText: string, ctx: any): ApplyPatchPreview | null {
	if (!patchText) return null;
	const key = `apply-meta:${ctx.cwd ?? process.cwd()}:${runtime.hash(patchText)}`;
	if (ctx.state?._applyPatchMetaKey === key && ctx.state._applyPatchPreview) return ctx.state._applyPatchPreview;
	try {
		const preview = parseApplyPatchPreview(patchText, {
			displayPath: runtime.displayPath,
			language: runtime.language,
			summary: runtime.summarizeDiff,
		});
		if (ctx.state) {
			ctx.state._applyPatchMetaKey = key;
			ctx.state._applyPatchPreview = preview;
			ctx.state._applyPatchMeta = buildApplyPatchResultMeta(preview);
		}
		return preview;
	} catch {
		return null;
	}
}
function resultMeta(runtime: ApplyPatchRuntime, args: any, ctx: any): ApplyPatchResultMeta | null {
	const patchText = getRawStringArg(args ?? ctx?.args, "patchText", "patch_text");
	const preview = patchText ? cachedPreview(runtime, patchText, ctx) : null;
	return preview && ctx.state?._applyPatchMeta ? ctx.state._applyPatchMeta : null;
}

export function renderApplyPatchCall(runtime: ApplyPatchRuntime, args: any, theme: Theme, ctx: any): any {
	runtime.syncCallStatus(ctx);
	const patchText = getRawStringArg(args, "patchText", "patch_text");
	const shortPath = (path: string) => runtime.displayPath(path);
	const summary = runtime.stableSummary(ctx, "_callSummary", () => runtime.summarizeCall(args, theme, shortPath));
	const header = runtime.header("Apply Patch", summary, theme, runtime.statusDot(ctx, theme));
	if (!runtime.diffPresentationEnabled() || !ctx.argsComplete) return runtime.makeText(ctx.lastComponent, header);
	const preview = cachedPreview(runtime, patchText, ctx);
	if (!preview?.changes.length) {
		ctx.state._openAiPatchFiles = [];
		return runtime.makeText(ctx.lastComponent, header);
	}
	ctx.state._openAiPatchFiles = preview.changes.map((change) => change.displayPath);
	const width = runtime.branchWidth();
	const key = `apply-preview:${ctx.state._applyPatchMetaKey ?? runtime.hash(patchText)}:${width}:${ctx.expanded ? 1 : 0}`;
	if (ctx.state._applyPatchPreviewKey !== key) {
		ctx.state._applyPatchPreviewKey = key;
		ctx.state._applyPatchPreviewBody = theme.fg("muted", "(rendering…)");
		ctx.state._applyPatchPreviewDisplay = runtime.withBranch(ctx.state._applyPatchPreviewBody, theme, false, true);
		const colors = runtime.resolveDiffColors(theme);
		if (preview.changes.length === 1) {
			const [change] = preview.changes;
			runtime.renderSplit(change.diff, change.language, ctx.expanded ? runtime.maxPreviewLines : 32, colors, width)
				.then((rendered) => {
					if (ctx.state._applyPatchPreviewKey !== key) return;
					ctx.state._applyPatchPreviewBody = `${describe(change)} ${change.summary}${lineMeta(change.line, theme)}\n${rendered}`;
					ctx.state._applyPatchPreviewDisplay = runtime.withBranch(ctx.state._applyPatchPreviewBody, theme, false, true);
					ctx.invalidate();
				})
				.catch(() => {
					if (ctx.state._applyPatchPreviewKey !== key) return;
					ctx.state._applyPatchPreviewDisplay = runtime.withBranch(`${describe(change)} ${change.summary}${lineMeta(change.line, theme)}`, theme, false, true);
					ctx.invalidate();
				});
		} else {
			const maxShown = ctx.expanded ? preview.changes.length : Math.min(preview.changes.length, 3);
			const rows = ctx.expanded ? Math.max(6, Math.floor(runtime.maxRenderLines / Math.max(1, maxShown))) : Math.max(8, Math.floor(runtime.maxPreviewLines / Math.max(1, maxShown)));
			Promise.all(preview.changes.slice(0, maxShown).map((change, index) =>
				runtime.renderSplit(change.diff, change.language, rows, colors, width)
					.then((rendered) => `${describe(change)} ${change.summary}${lineMeta(change.line, theme)}\n${rendered}`)
					.catch(() => `${index + 1}. ${describe(change)} ${change.summary}${lineMeta(change.line, theme)}`),
			)).then((sections) => {
				if (ctx.state._applyPatchPreviewKey !== key) return;
				const remaining = preview.changes.length - maxShown;
				const suffix = remaining > 0 ? `\n${theme.fg("muted", `… ${remaining} more file patches${ctx.expanded ? "" : " (ctrl+o to expand)"}`)}` : "";
				ctx.state._applyPatchPreviewDisplay = runtime.withBranch(`${preview.changes.length} files ${preview.summary}\n\n${sections.join("\n\n")}${suffix}`, theme, false, true);
				ctx.invalidate();
			}).catch(() => {
				if (ctx.state._applyPatchPreviewKey !== key) return;
				ctx.state._applyPatchPreviewDisplay = runtime.withBranch(`${preview.changes.length} files ${preview.summary}`, theme, false, true);
				ctx.invalidate();
			});
		}
	}
	const body = ctx.state._applyPatchPreviewDisplay as string | undefined;
	return runtime.makeText(ctx.lastComponent, body ? `${header}\n${body}` : header);
}

export function renderApplyPatchResult(runtime: ApplyPatchRuntime, result: any, isPartial: boolean, theme: Theme, ctx: any): any {
	if (isPartial) {
		runtime.startBlink(ctx);
		return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("dim", "Applying Patch..."), theme));
	}
	runtime.stopBlink(ctx);
	runtime.setStatus(ctx, ctx.isError ? "error" : "success");
	if (ctx.isError) {
		const raw = sanitizeToolOutput(getTextContent(result)).trim();
		return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("error", raw ? raw.split("\n")[0] : "Apply patch failed"), theme));
	}
	if (!runtime.diffPresentationEnabled()) return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("success", "Applied"), theme));
	const meta = resultMeta(runtime, ctx.args, ctx);
	if (!meta?.changeCount) return runtime.makeText(ctx.lastComponent, runtime.withBranch(theme.fg("success", "Applied"), theme));
	if (meta.changeCount === 1 && meta.firstChange) {
		const change = meta.firstChange;
		const summary = runtime.diffSummaryWithMeta(change.added, change.removed, change.hunks, change.kind === "add" ? "new file" : change.kind === "delete" ? "delete" : "");
		return runtime.makeText(ctx.lastComponent, runtime.withBranch(`${theme.fg("success", "Applied")} ${theme.fg("muted", change.displayPath)} ${summary}${lineMeta(change.line, theme)}`, theme));
	}
	const summary = runtime.diffSummaryWithMeta(meta.totalAdded, meta.totalRemoved, meta.totalHunks, "");
	return runtime.makeText(ctx.lastComponent, runtime.withBranch(`${theme.fg("success", "Applied")} ${meta.changeCount} files ${summary}${meta.totalLines ? ` ${theme.fg("muted", `(${meta.totalLines} diff lines)`)}` : ""}`, theme));
}
