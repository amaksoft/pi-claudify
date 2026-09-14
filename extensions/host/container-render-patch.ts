import { installMouseLayout } from "../mouse-layout.ts";
import { isInspectionGroupComponent } from "../inspection-group.ts";
import { isToolExecutionLike, toolComponentRecord } from "../pi-tool-adapter.ts";
import { sharedState } from "./shared-state.ts";

const PATCH_FLAG = Symbol.for("pi-claudify:container-render-patch");
const STATE_KEY = Symbol.for("pi-claudify:global-render-state");
const RENDER_CACHE = Symbol.for("pi-claudify:tool-render-cache");
const SETTINGS_REVISION = Symbol.for("pi-claudify:tool-render-settings-revision");
const PRESENTATION_REVISION = Symbol.for("pi-claudify:tool-component-presentation-revision");

interface Registry { originalRender: (this: unknown, width: number) => string[] }
interface ActiveState {
	owner?: object;
	hooks?: ContainerRenderHooks;
}
export interface ContainerRenderHooks {
	presentationSkipped(name: unknown): boolean;
	isInspectionCandidate(value: unknown): boolean;
	ensureInspectionGroups(container: unknown): void;
	renderStackedBash(container: unknown, width: number): { lines: string[]; layout: Array<{ component: unknown; height: number }> } | null;
	settingsRevision(): number;
	presentationRevision(): number;
	refreshPresentation(component: any): void;
	clearRenderCache(component: any): void;
	backgroundMode(): "default" | "transparent" | "outlines";
	isBlankLine(line: string): boolean;
	splitImageBlock(lines: string[]): { textLines: string[]; imageLines: string[] };
	clampLine(line: string, width: number): string;
	normalizeCheckGlyph(line: string): string;
	spacerLine(width: number): string;
	borderLine(width: number): string;
	reanchor(natural: number[], leading: number, trailing: number, top: number, bottom: number): number[];
	diagnostic(key: string, error: unknown): void;
}
function activeState(): ActiveState { return sharedState(STATE_KEY, () => ({})); }

function installOn(proto: any, pristine: (this: unknown, width: number) => string[]): void {
	const legacy = proto[PATCH_FLAG] === true;
	let registry = legacy ? undefined : proto[PATCH_FLAG] as Registry | undefined;
	if (!registry) {
		registry = { originalRender: legacy ? pristine : proto.render };
		proto[PATCH_FLAG] = registry;
		proto.render = function stableContainerRender(this: unknown, width: number): string[] {
			const hooks = activeState().hooks;
			return hooks ? renderWithHooks(this, width, registry!.originalRender, hooks) : registry!.originalRender.call(this, width);
		};
	}
}

function renderWithHooks(self: unknown, width: number, original: (this: unknown, width: number) => string[], hooks: ContainerRenderHooks): string[] {
	if (isToolExecutionLike(self) && hooks.presentationSkipped(toolComponentRecord(self).toolName)) return original.call(self, width);
	if (!isToolExecutionLike(self)) {
		const children = Array.isArray((self as any).children) ? (self as any).children as unknown[] : [];
		if (children.some((child) => isInspectionGroupComponent(child) || hooks.isInspectionCandidate(child))) {
			try { hooks.ensureInspectionGroups(self); } catch (error) { hooks.diagnostic("inspection-reconcile", error); }
		}
		const stacked = hooks.renderStackedBash(self, width);
		if (stacked) { installMouseLayout(self, { width, children: stacked.layout }); return stacked.lines; }
	}
	const settingsRevision = isToolExecutionLike(self) ? hooks.settingsRevision() : 0;
	if (isToolExecutionLike(self)) {
		const presentationRevision = hooks.presentationRevision();
		if ((self as any)[PRESENTATION_REVISION] !== presentationRevision) {
			(self as any)[PRESENTATION_REVISION] = presentationRevision;
			try { hooks.refreshPresentation(self); } catch (error) { hooks.diagnostic("presentation-refresh", error); }
			hooks.clearRenderCache(self);
		}
		if ((self as any)[SETTINGS_REVISION] !== settingsRevision) {
			(self as any)[SETTINGS_REVISION] = settingsRevision;
			hooks.clearRenderCache(self);
		}
		const cached = (self as any)[RENDER_CACHE];
		if (cached?.width === width && cached?.mode === hooks.backgroundMode() && cached?.settingsRevision === settingsRevision) return cached.lines;
	}
	const rendered = original.call(self, width);
	if (!Array.isArray(rendered) || rendered.length === 0 || !isToolExecutionLike(self) || hooks.backgroundMode() === "default") return rendered;
	let start = 0;
	while (start < rendered.length && hooks.isBlankLine(rendered[start])) start++;
	let end = rendered.length - 1;
	while (end >= start && hooks.isBlankLine(rendered[end])) end--;
	if (start > end) return rendered;
	const { textLines, imageLines } = hooks.splitImageBlock(rendered.slice(start, end + 1));
	if (imageLines.length > 0) return rendered;
	const core = textLines.map((line) => hooks.clampLine(hooks.normalizeCheckGlyph(line), width));
	const spacer = hooks.spacerLine(width);
	const mode = hooks.backgroundMode();
	const result = mode === "outlines" ? [spacer, hooks.borderLine(width), ...core, hooks.borderLine(width)] : [spacer, ...core];
	try {
		const layout = (self as any).mouseLayout;
		const children = Array.isArray((self as any).children) ? (self as any).children : [];
		if (layout && layout.width === width && Array.isArray(layout.children) && layout.children.length === children.length && children.length > 0) {
			const natural = layout.children.map((entry: any) => typeof entry?.height === "number" ? entry.height : 0);
			const heights = hooks.reanchor(natural, start, rendered.length - 1 - end, 1 + (mode === "outlines" && core.length ? 1 : 0), mode === "outlines" && core.length ? 1 : 0);
			installMouseLayout(self, { width, children: children.map((component: unknown, index: number) => ({ component, height: heights[index] ?? 0 })) });
		}
	} catch { /* host layout remains the fallback */ }
	(self as any)[RENDER_CACHE] = { width, mode, settingsRevision, lines: result };
	return result;
}

export function installContainerRenderPatch(prototypes: Iterable<any>, owner: object, pristine: (this: unknown, width: number) => string[], hooks: ContainerRenderHooks): void {
	for (const proto of new Set(prototypes)) installOn(proto, pristine);
	const active = activeState();
	active.owner = owner;
	active.hooks = hooks;
}
export function releaseContainerRenderPatch(owner: object): void {
	const active = activeState();
	if (active.owner !== owner) return;
	active.owner = undefined;
	active.hooks = undefined;
}
