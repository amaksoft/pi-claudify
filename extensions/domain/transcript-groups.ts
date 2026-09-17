export type TranscriptRunSegment<T> =
	| { readonly kind: "group"; readonly members: readonly T[]; readonly trailingTransparent: readonly T[] }
	| { readonly kind: "boundary"; readonly value: T };

export interface TranscriptRunPolicy<T> {
	isEligible(value: T): boolean;
	isTransparent(value: T): boolean;
}

/**
 * Pure semantic partitioning for transcript aggregation. Transparent records
 * do not split a run but remain ordered immediately after its projected group;
 * visible or unknown records are hard boundaries.
 */
export function partitionTranscriptRuns<T>(
	values: readonly T[],
	policy: TranscriptRunPolicy<T>,
): TranscriptRunSegment<T>[] {
	const output: TranscriptRunSegment<T>[] = [];
	let members: T[] = [];
	let transparent: T[] = [];
	const flush = () => {
		if (members.length > 0) output.push({ kind: "group", members, trailingTransparent: transparent });
		else for (const value of transparent) output.push({ kind: "boundary", value });
		members = [];
		transparent = [];
	};
	for (const value of values) {
		if (policy.isEligible(value)) {
			members.push(value);
			continue;
		}
		if (members.length > 0 && policy.isTransparent(value)) {
			transparent.push(value);
			continue;
		}
		flush();
		output.push({ kind: "boundary", value });
	}
	flush();
	return output;
}
