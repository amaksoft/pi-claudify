import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface SessionEventRuntime {
	onSessionStart(ctx: any): void;
	onTurnStart(ctx: any): void;
	installDeferred(ctx: any): void;
	discoverTools(): void;
	onTurnEnd(): void;
	onShutdown(): void;
}

export function registerSessionEvents(pi: ExtensionAPI, runtime: SessionEventRuntime): void {
	pi.on("session_start", async (_event, ctx) => { runtime.onSessionStart(ctx); runtime.installDeferred(ctx); runtime.discoverTools(); });
	pi.on("before_agent_start", async (_event, ctx) => { runtime.installDeferred(ctx); runtime.discoverTools(); });
	pi.on("turn_start", async (_event, ctx) => runtime.onTurnStart(ctx));
	pi.on("turn_end", async () => runtime.onTurnEnd());
	pi.on("session_shutdown", async () => runtime.onShutdown());
}
