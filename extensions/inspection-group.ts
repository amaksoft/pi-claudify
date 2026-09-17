import { Container } from "@earendil-works/pi-tui";

import { debugDiagnostic } from "./debug.ts";
import { installMouseLayout } from "./mouse-layout.ts";

/** Capture the unpatched host path once per process, surviving extension reloads. */
const HOST_CONTAINER_RENDER_KEY = Symbol.for("pi-claudify:host-container-render");
const renderRegistry = globalThis as Record<PropertyKey, unknown>;
export const HOST_CONTAINER_RENDER = (
	typeof renderRegistry[HOST_CONTAINER_RENDER_KEY] === "function"
		? renderRegistry[HOST_CONTAINER_RENDER_KEY]
		: Container.prototype.render
) as typeof Container.prototype.render;
if (!renderRegistry[HOST_CONTAINER_RENDER_KEY]) renderRegistry[HOST_CONTAINER_RENDER_KEY] = HOST_CONTAINER_RENDER;
const GROUP_BRAND = Symbol.for("pi-claudify:inspection-group-component");

export interface InteractiveRows {
	start: number;
	end: number;
}

export interface InspectionGroupFrame {
	lines: string[];
	interactiveRows: InteractiveRows;
}

/** Everything domain-specific stays outside the host-facing component. */
export interface InspectionGroupPolicy {
	isEligible(member: unknown): boolean;
	isSettled(member: unknown): boolean;
	setExpanded(member: unknown, expanded: boolean): void;
	onPointerExpand?(members: unknown[]): void;
	renderActive(members: unknown[], width: number): InspectionGroupFrame;
	renderSettled(members: unknown[], width: number): InspectionGroupFrame;
}

export interface InspectionGroupLike {
	getMembers(): unknown[];
	validates(): boolean;
	release(): void;
}

/** Optional counters for deterministic reconciliation complexity tests. */
export interface InspectionGroupReconciliationMetrics {
	flattenedMembers: number;
	indexedWrappers: number;
	reuseCandidateChecks: number;
}

export function isInspectionGroupComponent(value: unknown): value is InspectionGroupLike {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<PropertyKey, unknown>;
	return candidate[GROUP_BRAND] === true
		&& typeof candidate.getMembers === "function"
		&& typeof candidate.release === "function";
}

/**
 * A real transcript component for one consecutive run of aggregatable tools.
 * Collapsed/active lines belong to this component; expansion delegates to the
 * real members and the next reconciliation restores their native rows.
 */
export class InspectionGroupComponent extends Container implements InspectionGroupLike {
	private summaryStart = 0;
	private summaryEnd = 0;
	private nativeFallback = false;
	private policy: InspectionGroupPolicy;

	constructor(members: unknown[], policy: InspectionGroupPolicy) {
		super();
		(this as Record<PropertyKey, unknown>)[GROUP_BRAND] = true;
		this.policy = policy;
		for (const member of members) this.addChild(member as any);
	}

	/** Inherited children are the single ownership source. */
	getMembers(): unknown[] {
		const children = (this as unknown as { children?: unknown[] }).children;
		return Array.isArray(children) ? [...children] : [];
	}

	validates(): boolean {
		const members = this.getMembers();
		return members.length > 0 && members.every(this.policy.isEligible);
	}

	/** Reused wrappers must observe the policy supplied by this reconciliation. */
	refreshPolicy(policy: InspectionGroupPolicy): void {
		this.policy = policy;
	}

	release(): void {
		try { this.clear(); } catch { /* detached wrapper is already unreachable */ }
	}

	render(width: number): string[] {
		try {
			const members = this.getMembers();
			// Native fallback must use the captured host implementation: calling
			// super.render() after the process-global patch is installed recurses.
			if (width < 24 || !members.length || !members.every(this.policy.isEligible)) {
				this.nativeFallback = true;
				this.summaryStart = 0;
				this.summaryEnd = 0;
				return HOST_CONTAINER_RENDER.call(this, width);
			}

			this.nativeFallback = false;
			const frame = members.every(this.policy.isSettled)
				? this.policy.renderSettled(members, width)
				: this.policy.renderActive(members, width);
			this.summaryStart = frame.interactiveRows.start;
			this.summaryEnd = frame.interactiveRows.end;
			// We painted; members painted nothing. Prevent the host from inventing
			// hit regions for invisible native rows.
			installMouseLayout(this, { width, children: [] });
			return frame.lines;
		} catch (error) {
			debugDiagnostic("inspection-group-render", error);
			this.nativeFallback = true;
			this.summaryStart = 0;
			this.summaryEnd = 0;
			// Surface a second failure rather than silently deleting a member row.
			return HOST_CONTAINER_RENDER.call(this, width);
		}
	}

	handleMouse(event: any): any {
		if (this.nativeFallback) {
			const nativeHandler = (Container.prototype as any).handleMouse;
			return typeof nativeHandler === "function" ? nativeHandler.call(this, event) : undefined;
		}
		const button = event?.button;
		const isPrimary = button === "left" || button === 0 || button === "primary" || button === undefined;
		if (
			event?.type === "click" && isPrimary && this.validates()
			&& typeof event?.y === "number"
			&& event.y >= this.summaryStart && event.y < this.summaryEnd
		) {
			const members = this.getMembers();
			try { this.policy.onPointerExpand?.(members); } catch { /* expansion still works */ }
			this.setExpanded(true);
			return { handled: true };
		}
		return undefined;
	}

	get isExpandable(): boolean {
		return true;
	}

	setExpanded(expanded: boolean): void {
		for (const member of this.getMembers()) {
			try { this.policy.setExpanded(member, expanded); } catch { /* continue through the group */ }
		}
		try { this.invalidate(); } catch { /* optional on older hosts */ }
	}
}

/**
 * Canonical one-pass reconciliation:
 * 1. flatten every existing wrapper to its native members;
 * 2. partition that sequence under the CURRENT policy;
 * 3. construct a complete replacement plan;
 * 4. release every wrapper not reused;
 * 5. commit once, preserving the parent array identity.
 *
 * Planning before mutation prevents a setting change from requiring two
 * renders and prevents discarded adjacent wrappers retaining member ownership.
 */
export function reconcileInspectionGroups(
	container: unknown,
	policy: InspectionGroupPolicy,
	metrics?: InspectionGroupReconciliationMetrics,
	width?: number,
): void {
	if (metrics) {
		metrics.flattenedMembers = 0;
		metrics.indexedWrappers = 0;
		metrics.reuseCandidateChecks = 0;
	}
	const children = (container as { children?: unknown[] } | null)?.children;
	if (!Array.isArray(children) || children.length === 0) return;

	const original = [...children];
	const wrappers: InspectionGroupLike[] = [];
	const flattened: unknown[] = [];
	const reusableByFirstMember = new Map<unknown, Array<{ group: InspectionGroupComponent; members: unknown[] }>>();
	for (const child of original) {
		if (isInspectionGroupComponent(child)) {
			wrappers.push(child);
			const members = child.getMembers();
			flattened.push(...members);
			if (child instanceof InspectionGroupComponent && members.length > 0) {
				const bucket = reusableByFirstMember.get(members[0]) ?? [];
				bucket.push({ group: child, members });
				reusableByFirstMember.set(members[0], bucket);
				if (metrics) metrics.indexedWrappers++;
			}
		} else {
			flattened.push(child);
		}
	}
	if (metrics) metrics.flattenedMembers = flattened.length;

	const used = new Set<InspectionGroupLike>();
	const created: InspectionGroupComponent[] = [];
	const next: unknown[] = [];
	let run: unknown[] = [];
	let transparentGaps: unknown[] = [];
	const sameMembers = (current: unknown[], members: unknown[]): boolean =>
		current.length === members.length && current.every((member, index) => member === members[index]);
	const flush = () => {
		if (!run.length) { if (transparentGaps.length) next.push(...transparentGaps); transparentGaps = []; return; }
		const members = run;
		run = [];
		let reusable: InspectionGroupComponent | undefined;
		// A member can belong to only one valid transcript wrapper, so this bucket
		// is normally a singleton. Indexing by run identity avoids rescanning every
		// earlier wrapper for every separated run.
		for (const candidate of reusableByFirstMember.get(members[0]) ?? []) {
			if (metrics) metrics.reuseCandidateChecks++;
			if (!used.has(candidate.group) && sameMembers(candidate.members, members)) {
				reusable = candidate.group;
				break;
			}
		}
		if (reusable) {
			used.add(reusable);
			next.push(reusable);
		} else {
			const group = new InspectionGroupComponent(members, policy);
			created.push(group);
			next.push(group);
		}
		if (transparentGaps.length) next.push(...transparentGaps);
		transparentGaps = [];
	};

	try {
		for (const child of flattened) {
			if (policy.isEligible(child)) run.push(child);
			else {
				let transparent = false;
				if (run.length && typeof width === "number" && typeof (child as any)?.render === "function") {
					try { transparent = (child as any).render(width).length === 0; } catch { /* visible boundary fallback */ }
				}
				if (transparent) transparentGaps.push(child);
				else { flush(); next.push(child); }
			}
		}
		flush();
	} catch (error) {
		for (const group of created) group.release();
		throw error;
	}

	// Policy objects may carry live render callbacks or settings snapshots. A
	// membership-stable wrapper is still refreshed before it can render again.
	for (const wrapper of used) {
		if (wrapper instanceof InspectionGroupComponent) wrapper.refreshPolicy(policy);
	}
	const unchanged = original.length === next.length && original.every((child, index) => child === next[index]);
	if (unchanged) return;
	for (const wrapper of wrappers) {
		if (!used.has(wrapper)) wrapper.release();
	}
	children.length = 0;
	children.push(...next);
}
