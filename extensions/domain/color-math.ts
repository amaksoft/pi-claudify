export interface Rgb { r: number; g: number; b: number }

const CUBE_VALUES = [0, 95, 135, 175, 215, 255];

export function colorToRgb(value: string): Rgb | null {
	const hex = /^#([0-9a-fA-F]{6})$/.exec(value);
	if (hex) {
		return {
			r: Number.parseInt(hex[1].slice(0, 2), 16),
			g: Number.parseInt(hex[1].slice(2, 4), 16),
			b: Number.parseInt(hex[1].slice(4, 6), 16),
		};
	}
	const truecolor = /38;2;(\d+);(\d+);(\d+)/.exec(value);
	if (truecolor) return { r: +truecolor[1], g: +truecolor[2], b: +truecolor[3] };
	const indexed = /38;5;(\d+)/.exec(value);
	if (!indexed) return null;
	const index = +indexed[1];
	if (index < 16) return null;
	return xterm256ToRgb(index);
}

export function rgbToAnsi256(r: number, g: number, b: number): number {
	let best = 16;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let ri = 0; ri < CUBE_VALUES.length; ri++) {
		for (let gi = 0; gi < CUBE_VALUES.length; gi++) {
			for (let bi = 0; bi < CUBE_VALUES.length; bi++) {
				const distance = (r - CUBE_VALUES[ri]) ** 2 + (g - CUBE_VALUES[gi]) ** 2 + (b - CUBE_VALUES[bi]) ** 2;
				if (distance < bestDistance) {
					bestDistance = distance;
					best = 16 + 36 * ri + 6 * gi + bi;
				}
			}
		}
	}
	for (let index = 0; index < 24; index++) {
		const value = 8 + 10 * index;
		const distance = (r - value) ** 2 + (g - value) ** 2 + (b - value) ** 2;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = 232 + index;
		}
	}
	return best;
}

export function xterm256ToRgb(index: number): Rgb | null {
	if (!Number.isInteger(index) || index < 0 || index > 255) return null;
	if (index < 16) {
		const basic: Array<[number, number, number]> = [
			[0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
			[0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
			[128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
			[0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
		];
		const [r, g, b] = basic[index];
		return { r, g, b };
	}
	if (index < 232) {
		const offset = index - 16;
		return {
			r: CUBE_VALUES[Math.floor(offset / 36) % 6],
			g: CUBE_VALUES[Math.floor(offset / 6) % 6],
			b: CUBE_VALUES[offset % 6],
		};
	}
	const level = 8 + (index - 232) * 10;
	return { r: level, g: level, b: level };
}

export function parseAnsiRgb(ansi: string): Rgb | null {
	if (!ansi) return null;
	const truecolor = ansi.match(/\u001b\[(?:38|48);2;(\d+);(\d+);(\d+)m/);
	if (truecolor) return { r: +truecolor[1], g: +truecolor[2], b: +truecolor[3] };
	const indexed = ansi.match(/\u001b\[(?:38|48);5;(\d+)m/);
	return indexed ? xterm256ToRgb(+indexed[1]) : null;
}

export function hexToBgAnsi(hex: string): string {
	const rgb = colorToRgb(hex);
	return rgb ? `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m` : "";
}

export function hexToFgAnsi(hex: string): string {
	const rgb = colorToRgb(hex);
	return rgb ? `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m` : "";
}

export function mixRgb(a: Rgb, b: Rgb, ratio: number): Rgb {
	return {
		r: a.r + (b.r - a.r) * ratio,
		g: a.g + (b.g - a.g) * ratio,
		b: a.b + (b.b - a.b) * ratio,
	};
}

export function rgbToBgAnsi(color: Rgb): string {
	return `\x1b[48;2;${Math.round(color.r)};${Math.round(color.g)};${Math.round(color.b)}m`;
}
