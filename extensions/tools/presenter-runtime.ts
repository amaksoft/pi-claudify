import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ToolPresentationAdapter } from "../domain/tool-presentation.ts";

export interface ToolRegistrationRuntime {
	cwd: string;
	register(definition: any): void;
	registerExecution?: boolean;
	registerPresentation?(presentation: ToolPresentationAdapter): void;
	forwardContract(definition: any): Record<string, unknown>;
}

export interface ToolChromeRuntime extends ToolRegistrationRuntime {
	syncCallStatus(ctx: any): void;
	stableSummary(ctx: any, key: string, build: () => string, reveal?: boolean): string;
	makeText(last: unknown, text: string): any;
	header(label: string, summary: string, theme: Theme, prefix?: string): string;
	statusDot(ctx: any, theme: Theme): string;
	withBranch(content: string, theme: Theme, isError?: boolean, continued?: boolean): string;
	startBlink(ctx: any): void;
	stopBlink(ctx: any): void;
	setStatus(ctx: any, status: "pending" | "success" | "error"): void;
}

export interface WidthAwareToolRuntime extends ToolChromeRuntime {
	widthAware(last: unknown, key: string, build: (width: number) => string[], revision: () => number): any;
	renderLines(text: string, width: number): string[];
	revision(): number;
	hash(text: string): string;
}

export interface DiffCardRuntime {
	diffCard(
		last: unknown,
		key: string,
		placeholder: string,
		build: (width: number) => Promise<string>,
		invalidate: () => void,
		textRenderer: (text: string, width: number) => string[],
		fallback: string,
	): any;
	renderPrewrapped(text: string, width: number): string[];
}
