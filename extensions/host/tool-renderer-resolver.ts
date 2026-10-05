import { Text } from "@earendil-works/pi-tui";

import {
	compatibleInspectionToolName,
	supportsInspectionCall,
	supportsInspectionResult,
	type CompatibleInspectionToolName,
	type ToolPresentationAdapter,
} from "../domain/tool-presentation.ts";

/**
 * `pi.registerToolRenderer()` adapter (Pi >= 1.0.1).
 *
 * This module is the public-API counterpart of `tool-renderer-patch.ts`: it
 * serves the exact same presentation adapters through Pi's resolver chain
 * instead of a private `ToolExecutionComponent` prototype patch. The legacy
 * patch is selected by the same probe in the composition root; removing it
 * later means deleting that branch plus `tool-renderer-patch.ts`, while this
 * file and the shared hook policy below stay untouched.
 *
 * Semantics mirror the legacy patch slot for slot:
 * - resolve time (row creation): generation currency, tool kill switches,
 *   self-shell preservation, `apply_patch`/generic routing. A skipped or
 *   foreign tool returns `next()` verbatim, so Pi renders fully natively.
 * - render time (already-mounted rows): the wrappers re-check currency and
 *   kill switches, then arg/result-shape support and task native-row rules,
 *   delegating to the captured fallback for anything that fails. Adapter
 *   exceptions fall back to native with a diagnostic, exactly like legacy.
 */

export interface PublicToolRenderers {
	renderShell?: unknown;
	renderCall?: (...args: any[]) => unknown;
	renderResult?: (...args: any[]) => unknown;
}

export type RendererChainNext = () => PublicToolRenderers | undefined;
export type ToolRendererResolverFn = (toolName: string, next: RendererChainNext) => PublicToolRenderers | undefined;

export interface ToolRendererResolverHooks {
	isCurrent(): boolean;
	presentationSkipped(name: unknown): boolean;
	shouldUseGeneric(name: unknown): boolean;
	shouldUseNativeCall?(name: string, row: unknown): boolean;
	shouldUseNativeResult?(name: string, row: unknown): boolean;
	renderApplyCall(...args: any[]): unknown;
	renderApplyResult(...args: any[]): unknown;
	renderGenericCall(name: string, ...args: any[]): unknown;
	renderGenericResult(name: string, ...args: any[]): unknown;
	canOverrideSelfShell(name: string, definition: unknown): boolean;
	diagnostic(key: string, error: unknown): void;
	presentations(): Iterable<ToolPresentationAdapter>;
}

/** The host exposes the resolver API on Pi >= 1.0.1; older hosts keep the legacy patch. */
export function supportsToolRendererResolver(pi: unknown): boolean {
	try {
		return typeof (pi as any)?.registerToolRenderer === "function";
	} catch {
		return false;
	}
}

function callFallbackSlot(fallback: PublicToolRenderers | undefined, slot: "renderCall" | "renderResult", args: any[]): unknown {
	const slotRenderer = (fallback as any)?.[slot];
	if (typeof slotRenderer === "function") return (slotRenderer as (...slotArgs: any[]) => unknown)(...args);
	// Neither our adapter shape-check nor the host fallback has this slot
	// (malformed arguments on a tool whose base defines no renderer): render
	// nothing rather than throwing inside Pi's render pass.
	return new Text("", 0, 0);
}

export function createToolRendererResolver(hooks: ToolRendererResolverHooks): ToolRendererResolverFn {
	return (toolName: string, next: RendererChainNext) => {
		if (!hooks.isCurrent()) return next();
		const name = typeof toolName === "string" ? toolName : "";
		if (!name || hooks.presentationSkipped(name)) return next();
		let fallback: PublicToolRenderers | undefined;
		try {
			fallback = next();
		} catch {
			fallback = undefined;
		}
		const presentations = new Map(Array.from(hooks.presentations(), (adapter) => [adapter.name, adapter]));
		const adapter = presentations.get(compatibleInspectionToolName(name) as CompatibleInspectionToolName);
		const baseIsSelfShell = (fallback as any)?.renderShell === "self";
		const mayOverrideShell = !!adapter?.overrideSelfShell && hooks.canOverrideSelfShell(name, fallback) === true;
		if (adapter && !(baseIsSelfShell && !mayOverrideShell)) {
			const wrapSlot = (
				slot: "renderCall" | "renderResult",
				adapterRenderer: ((...args: any[]) => unknown) | undefined,
				shapeSupported: (row: any) => boolean,
				useNative: (row: any) => boolean,
				buildRow: (args: any[]) => any,
			): ((...args: any[]) => unknown) | undefined => {
				if (typeof adapterRenderer !== "function") return (fallback as any)?.[slot];
				return (...args: any[]) => {
					if (!hooks.isCurrent() || hooks.presentationSkipped(name)) return callFallbackSlot(fallback, slot, args);
					const row = buildRow(args);
					if (useNative(row) || !shapeSupported(row)) return callFallbackSlot(fallback, slot, args);
					try {
						return adapterRenderer(...args);
					} catch (error) {
						hooks.diagnostic(`presentation-${slot === "renderCall" ? "call" : "result"}:${name}`, error);
						return callFallbackSlot(fallback, slot, args);
					}
				};
			};
			return {
				...fallback,
				renderShell: adapter.overrideSelfShell ? "self" : (fallback as any)?.renderShell,
				...(adapter.renderCall
					? {
						renderCall: wrapSlot("renderCall", adapter.renderCall,
							(row) => supportsInspectionCall(adapter.name, row.args),
							(row) => hooks.shouldUseNativeCall?.(name, row) === true,
							(args) => ({ toolName: name, args: args[0] })),
					}
					: {}),
				...(adapter.renderResult
					? {
						renderResult: wrapSlot("renderResult", adapter.renderResult,
							(row) => supportsInspectionResult(adapter.name, row.result),
							(row) => hooks.shouldUseNativeResult?.(name, row) === true,
							(args) => ({
								toolName: name,
								result: args[0],
								isError: (args[1] as any)?.isError === true || (args[3] as any)?.isError === true,
								isPartial: (args[1] as any)?.isPartial === true,
							})),
					}
					: {}),
			} satisfies PublicToolRenderers;
		}
		if (name === "apply_patch") {
			return {
				...fallback,
				renderCall: (...args: any[]) => hooks.renderApplyCall(...args),
				renderResult: (...args: any[]) => hooks.renderApplyResult(...args),
			};
		}
		if (hooks.shouldUseGeneric(name)) {
			return {
				...fallback,
				renderCall: (...args: any[]) => hooks.renderGenericCall(name, ...args),
				renderResult: (...args: any[]) => hooks.renderGenericResult(name, ...args),
			};
		}
		return fallback;
	};
}
