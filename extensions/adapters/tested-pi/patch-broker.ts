import type { Disposable } from "../../runtime/contracts.ts";

const PATCH_BROKER_KEY = Symbol.for("pi-claudify:tested-pi-patch-broker");

interface OwnerBinding {
	retiring: boolean;
	rank: number;
	surfaces: Map<string, unknown>;
}

interface BrokerState {
	owners: Map<object, OwnerBinding>;
	nextRank: number;
}

function state(): BrokerState {
	const root = globalThis as Record<PropertyKey, unknown>;
	const current = (root[PATCH_BROKER_KEY] ??= { owners: new Map<object, OwnerBinding>(), nextRank: 1 }) as BrokerState;
	// One-time shape migration for a broker created by an older hot-reloaded
	// generation. Preserve insertion order when assigning its missing ranks.
	if (typeof current.nextRank !== "number") current.nextRank = 1;
	for (const value of current.owners.values()) {
		if (typeof value.rank !== "number") value.rank = current.nextRank++;
	}
	return current;
}

function binding(owner: object): OwnerBinding {
	const broker = state();
	let value = broker.owners.get(owner);
	if (!value) {
		const retiringRank = [...broker.owners.values()]
			.filter((candidate) => candidate.retiring)
			.reduce<number | undefined>((lowest, candidate) => lowest === undefined ? candidate.rank : Math.min(lowest, candidate.rank), undefined);
		value = { retiring: false, rank: retiringRank ?? broker.nextRank++, surfaces: new Map() };
		broker.owners.set(owner, value);
	}
	return value;
}

/**
 * Process-stable owner selection shared by every tested-Pi trampoline.
 *
 * Rank gives the outer/parent runtime priority over nested AgentSessions. A
 * successor inherits the lowest retiring rank, so parent reload cannot leave
 * an overlapping child authoritative. A retiring owner remains the gap
 * fallback for each surface until its same-rank successor binds that surface.
 */
export class PatchBroker {
	bind<T>(owner: object, surface: string, value: T): Disposable {
		const ownerBinding = binding(owner);
		ownerBinding.retiring = false;
		ownerBinding.surfaces.set(surface, value);
		let disposed = false;
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;
				const current = state().owners.get(owner);
				if (!current || current.surfaces.get(surface) !== value) return;
				current.surfaces.delete(surface);
				if (current.surfaces.size === 0) state().owners.delete(owner);
			},
		};
	}

	owned<T>(owner: object, surface: string): T | undefined {
		return state().owners.get(owner)?.surfaces.get(surface) as T | undefined;
	}

	values<T>(surface: string): readonly T[] {
		return [...state().owners.values()]
			.filter((value) => value.surfaces.has(surface))
			.map((value) => value.surfaces.get(surface) as T);
	}

	active<T>(surface: string): T | undefined {
		const candidates = [...state().owners.values()]
			.filter((value) => value.surfaces.has(surface))
			.sort((left, right) => left.rank - right.rank || Number(left.retiring) - Number(right.retiring));
		return candidates[0]?.surfaces.get(surface) as T | undefined;
	}

	markRetiring(owner: object): void {
		const value = state().owners.get(owner);
		if (value) value.retiring = true;
	}

	releaseSurface(owner: object, surface: string): void {
		const value = state().owners.get(owner);
		if (!value) return;
		value.surfaces.delete(surface);
		if (value.surfaces.size === 0) state().owners.delete(owner);
	}

	releaseOwner(owner: object): void {
		state().owners.delete(owner);
	}

	clearSurface(surface: string): void {
		for (const [owner, value] of state().owners) {
			value.surfaces.delete(surface);
			if (value.surfaces.size === 0) state().owners.delete(owner);
		}
	}

	inspect(): Readonly<{ owners: number; retiring: number; surfaces: number }> {
		const owners = [...state().owners.values()];
		return Object.freeze({
			owners: owners.length,
			retiring: owners.filter((owner) => owner.retiring).length,
			surfaces: owners.reduce((total, owner) => total + owner.surfaces.size, 0),
		});
	}
}

export const testedPiPatchBroker = new PatchBroker();
