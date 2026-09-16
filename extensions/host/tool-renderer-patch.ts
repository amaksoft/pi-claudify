import { ToolExecutionComponent, type Theme } from "@earendil-works/pi-coding-agent";

import {
	compatibleInspectionToolName,
	supportsInspectionCall,
	supportsInspectionResult,
	type ToolPresentationAdapter,
} from "../domain/tool-presentation.ts";
import { sharedState } from "./shared-state.ts";

const PATCH_FLAG = Symbol.for("pi-claudify:patched-tool-execution");
const STATE_KEY = Symbol.for("pi-claudify:tool-renderer-state");

interface PatchRegistry {
	originalHas?: Function;
	originalCall?: Function;
	originalResult?: Function;
}
interface ActiveState {
	owner?: object;
	presentations?: Map<string, ToolPresentationAdapter>;
	hooks?: ToolRendererHooks;
}
export interface ToolRendererHooks {
	presentationSkipped(name: unknown): boolean;
	shouldUseGeneric(name: unknown): boolean;
	renderApplyCall(args: any, theme: Theme, ctx: any): unknown;
	renderApplyResult(result: any, options: any, theme: Theme, ctx: any): unknown;
	renderGenericCall(name: string, args: any, theme: Theme, ctx: any): unknown;
	renderGenericResult(name: string, result: any, options: any, theme: Theme, ctx: any): unknown;
	diagnostic(key: string, error: unknown): void;
}

function activeState(): ActiveState { return sharedState(STATE_KEY, () => ({})); }
function compatible(component: any, phase: "call" | "result"): ToolPresentationAdapter | undefined {
	const state = activeState();
	const name = compatibleInspectionToolName(component?.toolName);
	if (!name || state.hooks?.presentationSkipped(name) || component?.toolDefinition?.renderShell === "self") return undefined;
	const adapter = state.presentations?.get(name);
	if (!adapter) return undefined;
	if (phase === "call") return adapter.renderCall && supportsInspectionCall(name, component?.args) ? adapter : undefined;
	return adapter.renderResult && supportsInspectionResult(name, component?.result) ? adapter : undefined;
}

/** Install stable methods once; hot reload only replaces global active state. */
export function installToolRendererPatch(owner: object, hooks: ToolRendererHooks): boolean {
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[PATCH_FLAG] === true) return true;
	let registry = proto[PATCH_FLAG] as PatchRegistry | undefined;
	if (!registry) {
		registry = { originalHas: proto.hasRendererDefinition, originalCall: proto.getCallRenderer, originalResult: proto.getResultRenderer };
		proto[PATCH_FLAG] = registry;
		proto.hasRendererDefinition = function stableHasRendererDefinition(this: any) {
			const state = activeState();
			if (state.hooks?.presentationSkipped(this?.toolName)) {
				return typeof registry!.originalHas === "function" ? registry!.originalHas.call(this) : false;
			}
			if (compatible(this, "call") || compatible(this, "result") || state.hooks?.shouldUseGeneric(this?.toolName)) return true;
			return typeof registry!.originalHas === "function" ? registry!.originalHas.call(this) : false;
		};
		proto.getCallRenderer = function stableGetCallRenderer(this: any) {
			const state = activeState();
			const toolName = typeof this?.toolName === "string" ? this.toolName : "";
			// The `apply_patch` and generic-tool branches below are compatibility.tools
			// gates (exact name / mcp:*/openai:*/generic:* family / default) that
			// `compatible()` does not cover on its own — check once, up front, so a
			// disabled tool falls all the way through to pi's native renderer.
			if (state.hooks?.presentationSkipped(toolName)) {
				return typeof registry!.originalCall === "function" ? registry!.originalCall.call(this) : undefined;
			}
			const adapter = compatible(this, "call");
			if (adapter?.renderCall) {
				const native = typeof registry!.originalCall === "function" ? registry!.originalCall.call(this) : undefined;
				return (...args: any[]) => {
					try { return adapter.renderCall!(...args); }
					catch (error) { state.hooks?.diagnostic(`presentation-call:${toolName}`, error); if (typeof native === "function") return native(...args); throw error; }
				};
			}
			if (toolName === "apply_patch") return state.hooks ? (args: any, theme: Theme, ctx: any) => state.hooks!.renderApplyCall(args, theme, ctx) : undefined;
			if (state.hooks?.shouldUseGeneric(toolName)) return (args: any, theme: Theme, ctx: any) => state.hooks!.renderGenericCall(toolName, args, theme, ctx);
			return typeof registry!.originalCall === "function" ? registry!.originalCall.call(this) : undefined;
		};
		proto.getResultRenderer = function stableGetResultRenderer(this: any) {
			const state = activeState();
			const toolName = typeof this?.toolName === "string" ? this.toolName : "";
			if (state.hooks?.presentationSkipped(toolName)) {
				return typeof registry!.originalResult === "function" ? registry!.originalResult.call(this) : undefined;
			}
			const adapter = compatible(this, "result");
			if (adapter?.renderResult) {
				const native = typeof registry!.originalResult === "function" ? registry!.originalResult.call(this) : undefined;
				return (...args: any[]) => {
					try { return adapter.renderResult!(...args); }
					catch (error) { state.hooks?.diagnostic(`presentation-result:${toolName}`, error); if (typeof native === "function") return native(...args); throw error; }
				};
			}
			if (toolName === "apply_patch") return state.hooks ? (result: any, options: any, theme: Theme, ctx: any) => state.hooks!.renderApplyResult(result, options, theme, ctx) : undefined;
			if (state.hooks?.shouldUseGeneric(toolName)) return (result: any, options: any, theme: Theme, ctx: any) => state.hooks!.renderGenericResult(toolName, result, options, theme, ctx);
			return typeof registry!.originalResult === "function" ? registry!.originalResult.call(this) : undefined;
		};
	}
	const state = activeState();
	state.owner = owner;
	state.hooks = hooks;
	state.presentations = new Map();
	return false;
}

export function installToolPresentations(owner: object, adapters: Iterable<ToolPresentationAdapter>): boolean {
	const state = activeState();
	if (state.owner !== owner) return false;
	state.presentations = new Map(Array.from(adapters, (adapter) => [adapter.name, adapter]));
	return true;
}

export function releaseToolRendererPatch(owner: object): void {
	const state = activeState();
	if (state.owner !== owner) return;
	state.owner = undefined;
	state.presentations = undefined;
	state.hooks = undefined;
}
