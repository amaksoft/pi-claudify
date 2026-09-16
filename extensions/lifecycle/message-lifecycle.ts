import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";

export interface MessageLifecycleRuntime {
	workedStartKey: PropertyKey;
	workedDurationKey: PropertyKey;
	patchThinking(text: string, theme?: Theme): string;
	stripThinking(text: string): string;
	stripWorked(text: string): string;
	appendWorked(message: any, durationMs: number, startedAt?: number): void;
}

export class MessageLifecycle {
	private agentStart: number | undefined;
	private assistantStart: number | undefined;

	currentAgentStart = (): number | undefined => this.agentStart;

	register(pi: ExtensionAPI, runtime: MessageLifecycleRuntime): void {
		const patchMessage = (event: any, theme?: Theme) => {
			const message = event?.message;
			if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return;
			for (const block of message.content) {
				if (block?.type === "thinking" && typeof block.thinking === "string") block.thinking = runtime.patchThinking(block.thinking, theme);
			}
		};
		const startAgent = () => {
			if (this.agentStart === undefined) this.agentStart = Date.now();
			this.assistantStart = undefined;
		};
		pi.on("before_agent_start", async () => startAgent());
		pi.on("agent_start", async () => startAgent());
		pi.on("message_start", async (event: any) => {
			const message = event?.message;
			if (message?.role === "user" && this.agentStart === undefined) this.agentStart = Date.now();
			if (message?.role === "assistant") {
				this.assistantStart = Date.now();
				message[runtime.workedStartKey] = this.assistantStart;
			}
		});
		pi.on("message_update", async (event, ctx) => patchMessage(event, ctx.ui?.theme));
		pi.on("message_end", async (event, ctx) => {
			const message = (event as any)?.message;
			if (message?.role === "assistant") {
				const started = this.agentStart ?? (typeof message[runtime.workedStartKey] === "number" ? message[runtime.workedStartKey] : this.assistantStart);
				const finalMessage = message.stopReason !== "toolUse";
				if (started !== undefined && finalMessage) {
					const duration = Date.now() - started;
					message[runtime.workedDurationKey] = duration;
					runtime.appendWorked(message, duration, started);
				}
				this.assistantStart = undefined;
			}
			patchMessage(event, ctx.ui?.theme);
		});
		pi.on("agent_end", async () => { this.agentStart = undefined; this.assistantStart = undefined; });
		pi.on("context", async (event) => {
			if (!Array.isArray((event as any).messages)) return;
			for (const message of (event as any).messages) {
				if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
				for (const block of message.content) {
					if (block?.type === "thinking" && typeof block.thinking === "string") block.thinking = runtime.stripThinking(block.thinking);
					if (block?.type === "text" && typeof block.text === "string") block.text = runtime.stripWorked(block.text);
				}
			}
		});
	}
}
