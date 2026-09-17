import { Spacer, Text } from "@earendil-works/pi-tui";
import { testedPiPatchBroker } from "../adapters/tested-pi/patch-broker.ts";
import { patchMethodOnce } from "./patch-once.ts";

const SURFACE = "assistant-message";
function activeRuntime(): AssistantMessagePatchRuntime | undefined { return testedPiPatchBroker.active<AssistantMessagePatchRuntime>(SURFACE); }

export interface AssistantMessagePatchRuntime {
	workedStartKey: PropertyKey;
	workedDurationKey: PropertyKey;
	currentAgentStart(): number | undefined;
	createParagraph(text: string, markdownTheme: any, style: any, thinking: boolean): any;
	hasWorkedDuration(message: any): boolean;
	workedDurationText(durationMs: number, startedAt?: number): string;
	/**
	 * `assistantMessages: false` pass-through, checked live on every
	 * `updateContent` call (not just at patch-install time) — see the identical
	 * rationale on UserMessagePatchRuntime.enabled.
	 */
	enabled(): boolean;
}

function isMarkdownComponent(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const candidate = value as any;
	return candidate.constructor?.name === "Markdown"
		&& typeof candidate.text === "string"
		&& typeof candidate.render === "function"
		&& typeof candidate.invalidate === "function";
}

export function patchAssistantMessageRenderer(ComponentClass: any, flag: symbol, owner: object, runtime: AssistantMessagePatchRuntime): void {
	testedPiPatchBroker.bind(owner, SURFACE, runtime);
	patchMethodOnce(ComponentClass?.prototype, flag, "updateContent", (originalUpdateContent) =>
		function patchedUpdateContent(this: any, message: any) {
		const active = activeRuntime();
		if (!active?.enabled()) return originalUpdateContent.call(this, message);
		if (!this[active.workedStartKey]) this[active.workedStartKey] = Date.now();
		if (!message || !Array.isArray(message.content)) return originalUpdateContent.call(this, message);
		originalUpdateContent.call(this, message);
		const container = this.contentContainer;
		if (!container?.children) return;
		const markdownTheme = this.markdownTheme;
		for (let index = container.children.length - 1; index >= 0; index--) {
			const child = container.children[index];
			if (!isMarkdownComponent(child) || !child.text) continue;
			container.children[index] = active.createParagraph(child.text, markdownTheme, child.defaultTextStyle, !!child.defaultTextStyle?.italic);
		}
		const explicitDuration = message[active.workedDurationKey];
		const componentStart = this[active.workedStartKey];
		const finalMessage = typeof message.stopReason === "string" && message.stopReason.length > 0 && message.stopReason !== "toolUse";
		const fallbackStart = active.currentAgentStart() ?? componentStart;
		const duration = typeof explicitDuration === "number" ? explicitDuration
			: finalMessage && typeof fallbackStart === "number" ? Date.now() - fallbackStart : undefined;
		const hasText = message.content.some((block: any) => block?.type === "text" && typeof block.text === "string" && block.text.trim());
		if (typeof duration === "number" && finalMessage && hasText && !active.hasWorkedDuration(message)) {
			container.children.push(new Spacer(1), new Text(active.workedDurationText(duration, componentStart), 0, 0));
		}
		},
	);
}

export function releaseAssistantMessageRenderer(owner: object): void { testedPiPatchBroker.releaseSurface(owner, SURFACE); }
