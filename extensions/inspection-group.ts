import { Container } from "@earendil-works/pi-tui";

import { installMouseLayout } from "./mouse-layout.ts";

/** Capture the unpatched host path before index.ts installs its global adapter. */
const HOST_CONTAINER_RENDER = Container.prototype.render;
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
	renderActive(members: unknown[], width: number): InspectionGroupFrame;
	renderSettled(members: unknown[], width: number): InspectionGroupFrame;
}

export interface InspectionGroupLike {
	getMembers(): unknown[];
	validates(): boolean;
	release(): void;
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
	private readonly policy: InspectionGroupPolicy;

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
		} catch {
			this.nativeFallback = true;
			this.summaryStart = 0;
			this.summaryEnd = 0;
			// Surface a second failure rather than silently deleting a member row.
			return HOST_CONTAINER_RENDER.call(this, width);
		}
	}

	handleMouse(event: any): unknown {
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
export function reconcileInspectionGroups(container: unknown, policy: InspectionGroupPolicy): void {
	const children = (container as { children?: unknown[] } | null)?.children;
	if (!Array.isArray(children) || children.length === 0) return;

	const original = [...children];
	const wrappers: InspectionGroupLike[] = [];
	const flattened: unknown[] = [];
	for (const child of original) {
		if (isInspectionGroupComponent(child)) {
			wrappers.push(child);
			flattened.push(...child.getMembers());
		} else {
			flattened.push(child);
		}
	}

	const used = new Set<InspectionGroupLike>();
	const created: InspectionGroupComponent[] = [];
	const next: unknown[] = [];
	let run: unknown[] = [];
	const sameMembers = (group: InspectionGroupLike, members: unknown[]): boolean => {
		const current = group.getMembers();
		return current.length === members.length && current.every((member, index) => member === members[index]);
	};
	const flush = () => {
		if (!run.length) return;
		const members = run;
		run = [];
		const reusable = wrappers.find(
			(group) => group instanceof InspectionGroupComponent && !used.has(group) && sameMembers(group, members),
		);
		if (reusable) {
			used.add(reusable);
			next.push(reusable);
			return;
		}
		const group = new InspectionGroupComponent(members, policy);
		created.push(group);
		next.push(group);
	};

	try {
		for (const child of flattened) {
			if (policy.isEligible(child)) run.push(child);
			else {
				flush();
				next.push(child);
			}
		}
		flush();
	} catch (error) {
		for (const group of created) group.release();
		throw error;
	}

	const unchanged = original.length === next.length && original.every((child, index) => child === next[index]);
	if (unchanged) return;
	for (const wrapper of wrappers) {
		if (!used.has(wrapper)) wrapper.release();
	}
	children.length = 0;
	children.push(...next);
}
