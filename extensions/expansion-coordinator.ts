import { matchesKey } from "@earendil-works/pi-tui";

interface ExpandableMember {
	expanded?: boolean;
	setExpanded?: (expanded: boolean) => void;
}

/**
 * Identifies one concrete transcript tree. Session changes, compaction, and any
 * other wholesale tree replacement must begin a new epoch so detached members
 * from the old tree can never claim a later Ctrl+O.
 */
export type PointerExpansionEpoch = number;

let pointerExpansionEpoch: PointerExpansionEpoch = 0;
const pointerExpandedMembers = new Map<ExpandableMember, PointerExpansionEpoch>();

export function currentPointerExpansionEpoch(): PointerExpansionEpoch {
	return pointerExpansionEpoch;
}

/**
 * Clear hook for session changes, compaction, and transcript-tree replacement.
 * Returning the token lets delayed producers prove that they still belong to
 * the current tree when they register members.
 */
export function beginPointerExpansionEpoch(): PointerExpansionEpoch {
	pointerExpansionEpoch++;
	pointerExpandedMembers.clear();
	return pointerExpansionEpoch;
}

export function markPointerExpandedMembers(
	members: unknown[],
	epoch: PointerExpansionEpoch = pointerExpansionEpoch,
): void {
	// Ignore a delayed click/update from a component belonging to an old tree.
	if (epoch !== pointerExpansionEpoch) return;
	for (const member of members) {
		if (member && typeof member === "object") {
			pointerExpandedMembers.set(member as ExpandableMember, epoch);
		}
	}
}

/** Backward-compatible lifecycle hook; also advances the transcript epoch. */
export function clearPointerExpandedMembers(): void {
	beginPointerExpansionEpoch();
}

export function collapsePointerExpandedMembers(
	epoch: PointerExpansionEpoch = pointerExpansionEpoch,
): boolean {
	if (epoch !== pointerExpansionEpoch) return false;
	let collapsed = false;
	for (const [member, memberEpoch] of [...pointerExpandedMembers]) {
		pointerExpandedMembers.delete(member);
		if (memberEpoch !== pointerExpansionEpoch) continue;
		try {
			if (member.expanded !== true || typeof member.setExpanded !== "function") continue;
			member.setExpanded(false);
		} catch {
			// One stale member must not prevent another current member collapsing.
		}
		try {
			// A detached/stale facade can retain `expanded: true` while accepting a
			// no-op call. Consume Ctrl+O only when a current member really closed.
			if (member.expanded !== true) collapsed = true;
		} catch { /* an unreadable stale facade did not prove that it collapsed */ }
	}
	return collapsed;
}

/**
 * Pi's global expand flag remains false after a local pointer expansion. Consume
 * exactly the next Ctrl+O to collapse what is visibly open; when there is no
 * pointer-opened state, return undefined so Pi's normal global toggle runs.
 */
export function handlePointerExpansionInput(data: string): { consume: true } | undefined {
	if (!matchesKey(data, "ctrl+o")) return undefined;
	return collapsePointerExpandedMembers() ? { consume: true } : undefined;
}
