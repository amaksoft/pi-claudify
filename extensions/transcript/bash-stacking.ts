// Consecutive-Bash stacking: when two or more `bash` tool rows sit back to
// back, drop the spacer line each one paints above itself so they read as one
// stacked block instead of separately-spaced rows.

import { settingsFeatureEnabled } from "../domain/compatibility.ts";
import { readSettings } from "../settings.ts";
import { snapshotToolExecution } from "./tool-record.ts";

export function isBashToolExecution(value: unknown): boolean {
	return snapshotToolExecution(value)?.name === "bash";
}

export function shouldStackConsecutiveBash(): boolean {
	const settings = readSettings().values;
	// `bashStacking: false` preserves native per-row spacing; it must not touch
	// read-only/shell inspection grouping, a separate feature/setting.
	if (!settingsFeatureEnabled(settings, "bashStacking")) return false;
	return settings.bashStackConsecutive !== false;
}

function cachedRenderLines(child: any, width: number, cache: Map<unknown, string[]>): string[] {
	const hit = cache.get(child);
	if (hit !== undefined) return hit;
	const lines = child.render(width);
	cache.set(child, lines);
	return lines;
}

function hasConsecutiveBashToolChildren(children: unknown[], width: number, cache: Map<unknown, string[]>): boolean {
	let previousWasBash = false;
	for (const child of children) {
		const currentIsBash = isBashToolExecution(child);
		if (currentIsBash && previousWasBash) return true;
		if (currentIsBash) previousWasBash = true;
		else {
			let transparent = false;
			try { transparent = typeof (child as any)?.render === "function" && cachedRenderLines(child as any, width, cache).length === 0; } catch { /* visible boundary */ }
			if (!transparent) previousWasBash = false;
		}
	}
	return false;
}

/**
 * `isBlankLine` is injected because index.ts's copy is shared with unrelated
 * rendering (image-block splitting, general tool-border framing); this module
 * never re-derives it.
 */
export interface BashStackingRuntime {
	isBlankLine(text: string): boolean;
}

function dropLeadingSpacerLine(lines: string[], runtime: BashStackingRuntime): string[] {
	return lines.length > 0 && runtime.isBlankLine(lines[0]) ? lines.slice(1) : lines;
}

export interface StackedBashLayoutEntry {
	component: unknown;
	height: number;
}

export interface StackedBashRender {
	lines: string[];
	layout: StackedBashLayoutEntry[];
}

export function renderWithStackedConsecutiveBash(
	container: any,
	width: number,
	runtime: BashStackingRuntime,
): StackedBashRender | null {
	if (!shouldStackConsecutiveBash()) return null;
	const children = Array.isArray(container?.children) ? container.children : null;
	// Single-frame probe cache: the transparency probe above renders non-bash
	// children, and the layout pass below needs the same lines. The cache lives
	// for this (container, width) call only, so no width/settingsRevision key
	// is needed — settings cannot change mid-call — and each child renders at
	// most once across both passes. Only successful renders are cached, so a
	// throwing child still surfaces from the layout pass as before.
	const probe = new Map<unknown, string[]>();
	if (!children || !hasConsecutiveBashToolChildren(children, width, probe)) return null;

	const lines: string[] = [];
	const layout: StackedBashLayoutEntry[] = [];
	let previousWasBash = false;
	for (const child of children) {
		const currentIsBash = isBashToolExecution(child);
		const childLines = typeof (child as any)?.render === "function" ? cachedRenderLines(child as any, width, probe) : [];
		const painted = currentIsBash && previousWasBash ? dropLeadingSpacerLine(childLines, runtime) : childLines;
		lines.push(...painted);
		layout.push({ component: child, height: painted.length });
		if (currentIsBash) previousWasBash = true;
		else if (painted.length > 0) previousWasBash = false;
	}
	return { lines, layout };
}
