// Consecutive-Bash stacking: when two or more `bash` tool rows sit back to
// back, drop the spacer line each one paints above itself so they read as one
// stacked block instead of separately-spaced rows.

import { isToolExecutionLike } from "../pi-tool-adapter.ts";
import { readSettings } from "../settings.ts";

export function isBashToolExecution(value: unknown): boolean {
	return isToolExecutionLike(value) && (value as any).toolName === "bash";
}

export function shouldStackConsecutiveBash(): boolean {
	return readSettings().values.bashStackConsecutive !== false;
}

function hasConsecutiveBashToolChildren(children: unknown[]): boolean {
	let previousWasBash = false;
	for (const child of children) {
		const currentIsBash = isBashToolExecution(child);
		if (currentIsBash && previousWasBash) return true;
		previousWasBash = currentIsBash;
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
	if (!children || !hasConsecutiveBashToolChildren(children)) return null;

	const lines: string[] = [];
	const layout: StackedBashLayoutEntry[] = [];
	let previousWasBash = false;
	for (const child of children) {
		const currentIsBash = isBashToolExecution(child);
		const childLines = typeof child?.render === "function" ? child.render(width) : [];
		const painted = currentIsBash && previousWasBash ? dropLeadingSpacerLine(childLines, runtime) : childLines;
		lines.push(...painted);
		layout.push({ component: child, height: painted.length });
		previousWasBash = currentIsBash;
	}
	return { lines, layout };
}
