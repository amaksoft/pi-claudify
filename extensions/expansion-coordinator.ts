import { matchesKey } from "@earendil-works/pi-tui";
import { testedPiPatchBroker } from "./adapters/tested-pi/patch-broker.ts";

interface ExpandableMember {
	expanded?: boolean;
	setExpanded?: (expanded: boolean) => void;
}

export type PointerExpansionEpoch = number;
interface PointerExpansionState {
	epoch: PointerExpansionEpoch;
	members: Map<ExpandableMember, PointerExpansionEpoch>;
}
const SURFACE = "pointer-expansion";
const DEFAULT_OWNER = {};
function state(owner: object = DEFAULT_OWNER): PointerExpansionState {
	let value = testedPiPatchBroker.owned<PointerExpansionState>(owner, SURFACE);
	if (!value) {
		value = { epoch: 0, members: new Map() };
		testedPiPatchBroker.bind(owner, SURFACE, value);
	}
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
	const values = testedPiPatchBroker.values<PointerExpansionState>(SURFACE);
	if (values.length === 0) { beginPointerExpansionEpoch(); return; }
	for (const current of values) { current.epoch++; current.members.clear(); }
}
export function releasePointerExpansionOwner(owner: object): void { testedPiPatchBroker.releaseSurface(owner, SURFACE); }

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
		for (const current of testedPiPatchBroker.values<PointerExpansionState>(SURFACE)) if (collapseState(current, current.epoch)) return true;
		return false;
	}
	const current = state(owner);
	return collapseState(current, epoch ?? current.epoch);
}

export function handlePointerExpansionInput(data: string, owner?: object): { consume: true } | undefined {
	if (!matchesKey(data, "ctrl+o")) return undefined;
	return collapsePointerExpandedMembers(undefined, owner) ? { consume: true } : undefined;
}
