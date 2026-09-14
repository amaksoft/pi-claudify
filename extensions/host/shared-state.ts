export interface OwnedState {
	owner?: object;
}

/** Process-stable state shared by hot-reloaded extension module generations. */
export function sharedState<T extends object>(key: symbol, initialize: () => T): T {
	const root = globalThis as Record<PropertyKey, unknown>;
	let state = root[key] as T | undefined;
	if (!state) {
		state = initialize();
		root[key] = state;
	}
	return state;
}

/** Release state only when the caller still owns the active generation. */
export function releaseOwnedState<T extends OwnedState>(state: T, owner: object, clear: (state: T) => void): boolean {
	if (state.owner !== owner) return false;
	clear(state);
	state.owner = undefined;
	return true;
}
