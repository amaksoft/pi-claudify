import { writeFileSync } from "node:fs";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { testedPiPatchBroker } from "../../extensions/adapters/tested-pi/patch-broker.ts";

const nativeCall = () => new Text("NATIVE_GREP", 0, 0);
const definition: any = {
	name: "grep", label: "grep", description: "probe", parameters: Type.Object({ pattern: Type.String() }),
	async execute() { return { content: [{ type: "text", text: "ok" }] }; },
	renderCall: nativeCall,
	renderResult: () => new Text("NATIVE_RESULT", 0, 0),
};
function isNative(): boolean {
	const component: any = new (ToolExecutionComponent as any)("grep", `probe-${Date.now()}`, { pattern: "needle" }, { showImages: false }, definition, { requestRender() {} }, process.cwd());
	return component.getCallRenderer?.() === nativeCall;
}

const TOOL_RENDERER_PATCH_FLAG = Symbol.for("pi-claudify:patched-tool-execution");

export default function (pi: any): void {
	// On resolver hosts (Pi >= 1.0.1) Pi consults the resolver chain only when
	// the interactive loop creates rows; direct construction below bypasses it
	// by design, so the probe reads native before/after. The nested (fake
	// legacy host) child still installs the global legacy patch, hence wrapped
	// during. Legacy hosts serve adapters through the prototype patch itself.
	const useResolverPath = typeof pi?.registerToolRenderer === "function";
	pi.registerCommand("repro-nested-owner", {
		description: "Exercise nested extension ownership",
		handler: async (_args: string, ctx: any) => {
			const prototypeUnpatchedBefore = (ToolExecutionComponent.prototype as any)[TOOL_RENDERER_PATCH_FLAG] === undefined;
			const beforeNative = isNative();
			const ownersBefore = testedPiPatchBroker.inspect().owners;
			const handlers = new Map<string, Function[]>();
			const tools = new Map<string, any>();
			const childPi: any = {
				registerTool(value: any) { tools.set(value.name, value); }, registerCommand() {}, getThinkingLevel() { return "off"; }, sendUserMessage() {},
				getAllTools() { return [...tools.values()]; },
				on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
			};
			const { default: claudify } = await import("../../extensions/index.ts");
			claudify(childPi);
			const duringNative = isNative();
			const ownersDuring = testedPiPatchBroker.inspect().owners;
			for (const handler of handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown", reason: "quit" }, ctx);
			const afterNative = isNative();
			const ownersAfter = testedPiPatchBroker.inspect().owners;
			writeFileSync(process.env.PI_CLAUDIFY_NESTED_OWNER_STATE!, JSON.stringify({ beforeNative, duringNative, afterNative, ownersBefore, ownersDuring, ownersAfter, useResolverPath, prototypeUnpatchedBefore }));
			ctx.ui.notify(`NESTED_OWNER before=${beforeNative} during=${duringNative} after=${afterNative}`, "info");
		},
	});
}
