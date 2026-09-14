import assert from "node:assert/strict";

import {
	colorToRgb,
	hexToBgAnsi,
	hexToFgAnsi,
	mixRgb,
	parseAnsiRgb,
	rgbToAnsi256,
	rgbToBgAnsi,
	xterm256ToRgb,
} from "../extensions/domain/color-math.ts";

assert.deepEqual(colorToRgb("#123456"), { r: 0x12, g: 0x34, b: 0x56 });
assert.deepEqual(colorToRgb("\x1b[38;2;1;2;3m"), { r: 1, g: 2, b: 3 });
assert.deepEqual(colorToRgb("\x1b[38;5;232m"), { r: 8, g: 8, b: 8 });
assert.equal(colorToRgb("not-a-color"), null);
assert.deepEqual(xterm256ToRgb(16), { r: 0, g: 0, b: 0 });
assert.deepEqual(xterm256ToRgb(255), { r: 238, g: 238, b: 238 });
assert.equal(xterm256ToRgb(256), null);
assert.deepEqual(parseAnsiRgb("\x1b[48;2;10;20;30m"), { r: 10, g: 20, b: 30 });
assert.deepEqual(parseAnsiRgb("\x1b[38;5;196m"), { r: 255, g: 0, b: 0 });
assert.equal(rgbToAnsi256(255, 0, 0), 196);
assert.equal(hexToBgAnsi("#010203"), "\x1b[48;2;1;2;3m");
assert.equal(hexToFgAnsi("#010203"), "\x1b[38;2;1;2;3m");
assert.deepEqual(mixRgb({ r: 0, g: 10, b: 20 }, { r: 100, g: 30, b: 40 }, 0.5), { r: 50, g: 20, b: 30 });
assert.equal(rgbToBgAnsi({ r: 1.2, g: 2.6, b: 3.4 }), "\x1b[48;2;1;3;3m");

console.log("color math tests passed");
