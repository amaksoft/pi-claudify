import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { deleteAllKittyImages, getCapabilities } from "@earendil-works/pi-tui";

import { testedPiPatchBroker } from "../adapters/tested-pi/patch-broker.ts";
import { sanitizeToolOutput, sanitizeToolText } from "../terminal-sanitize.ts";

const FALLBACK_FLAG = Symbol.for("pi-claudify:patched-tool-fallback-sanitize");
const FALLBACK_SURFACE = "tool-fallback-sanitizer";
const CACHE_FLAG = Symbol.for("pi-claudify:patched-tool-cache-invalidation");
const IMAGE_FLAG = Symbol.for("pi-claudify:patched-read-image-expansion");
const IMAGE_SURFACE = "read-image-expansion";
const INDENT_FLAG = Symbol.for("pi-claudify:patched-tool-row-indent");
const INDENT_SURFACE = "tool-row-layout";

interface FallbackRegistry {
	originalGetTextOutput?: Function;
	originalCreateCallFallback?: Function;
	originalFormatToolExecution?: Function;
}

export function installToolFallbackSanitization(owner: object): boolean {
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[FALLBACK_FLAG] === true) return true;
	let registry = proto[FALLBACK_FLAG] as FallbackRegistry | undefined;
	if (!registry) {
		registry = { originalGetTextOutput: proto.getTextOutput, originalCreateCallFallback: proto.createCallFallback, originalFormatToolExecution: proto.formatToolExecution };
		proto[FALLBACK_FLAG] = registry;
		if (typeof registry.originalGetTextOutput === "function") {
			proto.getTextOutput = function stableGetTextOutput(this: any, ...args: any[]) {
				const output = registry!.originalGetTextOutput!.apply(this, args);
				return testedPiPatchBroker.active<boolean>(FALLBACK_SURFACE) ? sanitizeToolOutput(output) : output;
			};
		}
		for (const [method, original] of [["createCallFallback", registry.originalCreateCallFallback], ["formatToolExecution", registry.originalFormatToolExecution]] as const) {
			if (typeof original !== "function") continue;
			proto[method] = function stableFallbackCall(this: any, ...args: any[]) {
				if (!testedPiPatchBroker.active<boolean>(FALLBACK_SURFACE)) return original.apply(this, args);
				const toolName = this.toolName;
				if (typeof toolName === "string") this.toolName = sanitizeToolText(toolName);
				try { return original.apply(this, args); } finally { this.toolName = toolName; }
			};
		}
	}
	testedPiPatchBroker.bind(owner, FALLBACK_SURFACE, true);
	return false;
}

export function releaseToolFallbackSanitization(owner?: object): void {
	if (owner === undefined) testedPiPatchBroker.clearSurface(FALLBACK_SURFACE);
	else testedPiPatchBroker.releaseSurface(owner, FALLBACK_SURFACE);
}

export function installToolCacheInvalidation(clearCache: (component: any) => void): void {
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[CACHE_FLAG]) return;
	for (const method of ["updateDisplay", "updateArgs", "markExecutionStarted", "setArgsComplete", "updateResult", "setExpanded", "setShowImages", "setImageWidthCells", "invalidate"]) {
		const original = proto[method];
		if (typeof original !== "function") continue;
		proto[method] = function patchedToolMutation(this: any, ...args: any[]) {
			clearCache(this);
			const result = original.apply(this, args);
			clearCache(this);
			return result;
		};
	}
	proto[CACHE_FLAG] = true;
}

function removeImageChildren(component: any, clearCache: (component: any) => void): void {
	if (process.stdout.isTTY && getCapabilities().images === "kitty" && Array.isArray(component.imageComponents) && component.imageComponents.length > 0) {
		try { process.stdout.write(deleteAllKittyImages()); } catch { /* terminal is closing */ }
	}
	const children = [...(Array.isArray(component.imageComponents) ? component.imageComponents : []), ...(Array.isArray(component.imageSpacers) ? component.imageSpacers : [])];
	for (const child of children) { try { component.removeChild?.(child); } catch { /* detached */ } }
	component.imageComponents = [];
	component.imageSpacers = [];
	clearCache(component);
}

interface ReadImageExpansionState {
	clearCache?: (component: any) => void;
	enabled?: () => boolean;
}

export function installReadImageExpansion(owner: object, clearCache: (component: any) => void, enabled: () => boolean = () => true): void {
	testedPiPatchBroker.bind(owner, IMAGE_SURFACE, { clearCache, enabled } satisfies ReadImageExpansionState);
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[IMAGE_FLAG]) return;
	const original = proto.updateDisplay;
	if (typeof original !== "function") return;
	proto.updateDisplay = function patchedReadImageUpdateDisplay(this: any, ...args: any[]) {
		const result = original.apply(this, args);
		const active = testedPiPatchBroker.active<ReadImageExpansionState>(IMAGE_SURFACE);
		if (!active?.enabled?.()) return result;
		const hasImage = Array.isArray(this.result?.content) && this.result.content.some((block: any) => block?.type === "image");
		if (this.toolName === "read" && hasImage && this.expanded !== true) removeImageChildren(this, active.clearCache ?? clearCache);
		return result;
	};
	proto[IMAGE_FLAG] = true;
}

export function releaseReadImageExpansion(owner: object): void {
	testedPiPatchBroker.releaseSurface(owner, IMAGE_SURFACE);
}

interface ToolRowLayoutState {
	backgroundMode?: () => "default" | "transparent" | "outlines";
	enabled?: () => boolean;
}

export function installToolRowLayout(
	owner: object,
	backgroundMode: () => "default" | "transparent" | "outlines",
	enabled: () => boolean = () => true,
): void {
	testedPiPatchBroker.bind(owner, INDENT_SURFACE, { backgroundMode, enabled } satisfies ToolRowLayoutState);
	const proto = ToolExecutionComponent.prototype as any;
	if (proto[INDENT_FLAG]) return;
	const original = proto.updateDisplay;
	if (typeof original !== "function") return;
	proto.updateDisplay = function patchedToolLayout(this: any, ...args: any[]) {
		const active = testedPiPatchBroker.active<ToolRowLayoutState>(INDENT_SURFACE);
		if (!active?.enabled?.()) return original.apply(this, args);
		for (const box of [this.contentBox, this.contentText]) {
			if (!box) continue;
			let changed = false;
			if (box.paddingX !== 0) { box.paddingX = 0; changed = true; }
			if (typeof box.paddingY === "number" && box.paddingY !== 0) { box.paddingY = 0; changed = true; }
			if (changed) box.invalidate?.();
		}
		const result = original.apply(this, args);
		if (active.backgroundMode?.() !== "default") {
			this.contentBox?.setBgFn?.((text: string) => text);
			this.contentText?.setCustomBgFn?.((text: string) => text);
		}
		return result;
	};
	proto[INDENT_FLAG] = true;
}

export function releaseToolRowLayout(owner: object): void {
	testedPiPatchBroker.releaseSurface(owner, INDENT_SURFACE);
}

export function markToolComponentPatchesRetiring(owner: object): void {
	testedPiPatchBroker.markRetiring(owner);
}
