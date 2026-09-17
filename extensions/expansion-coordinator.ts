import { matchesKey } from "@earendil-works/pi-tui";

interface ExpandableMember {
	expanded?: boolean;
	setExpanded?: (expanded: boolean) => void;
}

export type PointerExpansionEpoch = number;
interface PointerExpansionState {
	epoch: PointerExpansionEpoch;
	members: Map<ExpandableMember, PointerExpansionEpoch>;
}
const STATE_KEY = Symbol.for("pi-claudify:pointer-expansion-owners");
const DEFAULT_OWNER = Symbol.for("pi-claudify:pointer-expansion-default-owner");
function states(): Map<object | symbol, PointerExpansionState> {
	const root = globalThis as Record<PropertyKey, unknown>;
	return (root[STATE_KEY] ??= new Map<object | symbol, PointerExpansionState>()) as Map<object | symbol, PointerExpansionState>;
}
function ownerKey(owner?: object): object | symbol { return owner ?? DEFAULT_OWNER; }
function state(owner?: object): PointerExpansionState {
	const key = ownerKey(owner);
	let value = states().get(key);
	if (!value) { value = { epoch: 0, members: new Map() }; states().set(key, value); }
	return value;
}

export function currentPointerExpansionEpoch(owner?: object): PointerExpansionEpoch { return state(owner).epoch; }

export function beginPointerExpansionEpoch(owner?: object): PointerExpansionEpoch {
	const current = state(owner);
	current.epoch++;
	current.members.clear();
	return current.epoch;
}

export function markPointerExpandedMembers(
	members: unknown[],
	epoch?: PointerExpansionEpoch,
	owner?: object,
): void {
	const current = state(owner);
	const expected = epoch ?? current.epoch;
	if (expected !== current.epoch) return;
	for (const member of members) if (member && typeof member === "object") current.members.set(member as ExpandableMember, expected);
}

export function clearPointerExpandedMembers(owner?: object): void {
	if (owner !== undefined) { beginPointerExpansionEpoch(owner); return; }
	if (states().size === 0) { beginPointerExpansionEpoch(); return; }
	for (const current of states().values()) { current.epoch++; current.members.clear(); }
}
export function releasePointerExpansionOwner(owner: object): void { states().delete(owner); }

function collapseState(current: PointerExpansionState, expected: PointerExpansionEpoch): boolean {
	if (expected !== current.epoch) return false;
	let collapsed = false;
	for (const [member, memberEpoch] of [...current.members]) {
		current.members.delete(member);
		if (memberEpoch !== current.epoch) continue;
		try {
			if (member.expanded !== true || typeof member.setExpanded !== "function") continue;
			member.setExpanded(false);
		} catch { /* continue through stale members */ }
		try { if (member.expanded !== true) collapsed = true; } catch { /* no proof of collapse */ }
	}
	return collapsed;
}

export function collapsePointerExpandedMembers(epoch?: PointerExpansionEpoch, owner?: object): boolean {
	if (owner === undefined && epoch === undefined) {
		for (const current of states().values()) if (collapseState(current, current.epoch)) return true;
		return false;
	}
	const current = state(owner);
	return collapseState(current, epoch ?? current.epoch);
}

export function handlePointerExpansionInput(data: string, owner?: object): { consume: true } | undefined {
	if (!matchesKey(data, "ctrl+o")) return undefined;
	return collapsePointerExpandedMembers(undefined, owner) ? { consume: true } : undefined;
}
