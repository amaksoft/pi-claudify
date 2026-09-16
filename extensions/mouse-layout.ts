export interface MouseLayoutEntry {
	component: unknown;
	height: number;
}

export interface MouseLayout {
	width: number;
	children: MouseLayoutEntry[];
}

/** Best-effort bridge to pi-tui >=0.85's currently undocumented hit map. */
export function installMouseLayout(component: unknown, layout: MouseLayout | undefined): void {
	try {
		(component as { mouseLayout?: MouseLayout }).mouseLayout = layout;
	} catch {
		// Older/read-only host: keyboard expansion still works.
	}
}

/**
 * Re-anchor child heights after leading/trailing blanks are removed and framing
 * is added. Trimming is consumed across child boundaries, preserving the exact
 * total painted height even for custom renderers whose edge child is all blank.
 */
export function anchorFramedHeights(
	naturalHeights: number[],
	leadingBlanks: number,
	trailingBlanks: number,
	topFraming: number,
	bottomFraming: number,
): number[] {
	const heights = naturalHeights.map((height) => Math.max(0, height));
	if (heights.length === 0) return heights;

	let leading = Math.max(0, leadingBlanks);
	for (let index = 0; index < heights.length && leading > 0; index++) {
		const removed = Math.min(heights[index], leading);
		heights[index] -= removed;
		leading -= removed;
	}
	let trailing = Math.max(0, trailingBlanks);
	for (let index = heights.length - 1; index >= 0 && trailing > 0; index--) {
		const removed = Math.min(heights[index], trailing);
		heights[index] -= removed;
		trailing -= removed;
	}

	heights[0] += Math.max(0, topFraming);
	heights[heights.length - 1] += Math.max(0, bottomFraming);
	return heights;
}
