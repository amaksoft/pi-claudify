/**
 * The inspection-group render policy needs a handful of values that index.ts
 * owns as mutable, theme/settings-derived state (border color, tool rule,
 * worked-line foreground, tool background mode) plus a couple of broadly
 * shared pure helpers (shortPath, summarizeText, wrapMarkedLine, padToWidth).
 *
 * Rather than re-deriving or duplicating that state in this module, index.ts
 * builds one `InspectionGroupRuntime` per reconciliation call and injects it —
 * the same "*Runtime" pattern already used for generic/apply-patch/user-message
 * tool rendering (see tools/generic-tool.ts, tools/apply-patch-tool.ts,
 * host/user-message-patch.ts).
 */
export type ToolBackgroundMode = "default" | "transparent" | "outlines";

export interface InspectionGroupRuntime {
	/** Shared skip-list check applied to every presentation override, not just inspection rows. */
	isPresentationOverrideSkipped(toolName: unknown): boolean;
	onPointerExpand(members: unknown[]): void;
	shortPath(cwd: string, filePath: string): string;
	summarizeText(text: string, max?: number): string;
	wrapMarkedLine(line: string, width: number): string[];
	padToWidth(line: string, width: number): string;
	borderLine(width: number): string;
	syncToolBackgroundMode(): void;
	toolBackgroundMode(): ToolBackgroundMode;
	toolRule(): string;
	workedLineForeground(): string;
}
