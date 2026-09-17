import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface SessionEventRuntime {
	isCurrent?(): boolean;
	onSessionStart(ctx: any): void;
	onTurnStart(ctx: any): void;
	installDeferred(ctx: any): void;
	discoverTools(): void;
	onTurnEnd(): void;
	onShutdown(reason: "quit" | "reload" | "new" | "resume" | "fork"): void | Promise<void>;
}

export function registerSessionEvents(pi: ExtensionAPI, runtime: SessionEventRuntime): void {
	const current = () => runtime.isCurrent?.() !== false;
	pi.on("session_start", async (_event, ctx) => {
		if (!current()) return;
		runtime.onSessionStart(ctx);
		runtime.installDeferred(ctx);
		runtime.discoverTools();
	});
	pi.on("before_agent_start", async (_event, ctx) => {
		if (!current()) return;
		runtime.installDeferred(ctx);
		runtime.discoverTools();
	});
	pi.on("turn_start", async (_event, ctx) => { if (current()) runtime.onTurnStart(ctx); });
	pi.on("turn_end", async () => { if (current()) runtime.onTurnEnd(); });
	pi.on("session_shutdown", async (event) => runtime.onShutdown(event.reason));
}
