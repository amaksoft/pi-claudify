import { Spacer, Text } from "@earendil-works/pi-tui";
import { patchMethodOnce } from "./patch-once.ts";

export interface AssistantMessagePatchRuntime {
	workedStartKey: PropertyKey;
	workedDurationKey: PropertyKey;
	currentAgentStart(): number | undefined;
	createParagraph(text: string, markdownTheme: any, style: any, thinking: boolean): any;
	hasWorkedDuration(message: any): boolean;
	workedDurationText(durationMs: number, startedAt?: number): string;
}

function isMarkdownComponent(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const candidate = value as any;
	return candidate.constructor?.name === "Markdown"
		&& typeof candidate.text === "string"
		&& typeof candidate.render === "function"
		&& typeof candidate.invalidate === "function";
}

export function patchAssistantMessageRenderer(ComponentClass: any, flag: symbol, runtime: AssistantMessagePatchRuntime): void {
	patchMethodOnce(ComponentClass?.prototype, flag, "updateContent", (originalUpdateContent) =>
		function patchedUpdateContent(this: any, message: any) {
		if (!this[runtime.workedStartKey]) this[runtime.workedStartKey] = Date.now();
		if (!message || !Array.isArray(message.content)) return originalUpdateContent.call(this, message);
		originalUpdateContent.call(this, message);
		const container = this.contentContainer;
		if (!container?.children) return;
		const markdownTheme = this.markdownTheme;
		for (let index = container.children.length - 1; index >= 0; index--) {
			const child = container.children[index];
			if (!isMarkdownComponent(child) || !child.text) continue;
			container.children[index] = runtime.createParagraph(child.text, markdownTheme, child.defaultTextStyle, !!child.defaultTextStyle?.italic);
		}
		const explicitDuration = message[runtime.workedDurationKey];
		const componentStart = this[runtime.workedStartKey];
		const finalMessage = typeof message.stopReason === "string" && message.stopReason.length > 0 && message.stopReason !== "toolUse";
		const fallbackStart = runtime.currentAgentStart() ?? componentStart;
		const duration = typeof explicitDuration === "number" ? explicitDuration
			: finalMessage && typeof fallbackStart === "number" ? Date.now() - fallbackStart : undefined;
		const hasText = message.content.some((block: any) => block?.type === "text" && typeof block.text === "string" && block.text.trim());
		if (typeof duration === "number" && finalMessage && hasText && !runtime.hasWorkedDuration(message)) {
			container.children.push(new Spacer(1), new Text(runtime.workedDurationText(duration, componentStart), 0, 0));
		}
		},
	);
}
