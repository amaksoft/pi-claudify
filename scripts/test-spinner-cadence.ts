import assert from "node:assert/strict";

import { Loader } from "@earendil-works/pi-tui";

// Importing spinner.ts monkey-patches Loader.prototype (start/stop/updateDisplay)
// and exposes the captured live-spinner cadence.
const { LOADER_INTERVAL_MS } = await import("../extensions/spinner.ts");

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const identity = (text: string): string => text;

// A minimal UI stub: the patched updateDisplay only needs requestRender + a
// falsy `stopped`/`theme`. No real terminal is involved.
const ui = { requestRender(): void {}, stopped: false, theme: undefined } as any;

const loader = new Loader(ui, identity, identity, "Working");
// The patched start() schedules a real (unref'd) timer; cancel it so the test
// drives frames deterministically instead of racing wall-clock ticks.
loader.stop();

function glyphAtFrame(frame: number): string {
	(loader as any).currentFrame = frame;
	(loader as any).updateDisplay();
	const rendered = loader.render(80).join("\n").replace(ANSI_RE, "").trim();
	return Array.from(rendered)[0] ?? "";
}

// --- Cadence: Claude Code advances the live glyph at 2 Hz (CLFY-8) -----------
// The audit's gap #6 mis-captured this as a *static* `·` by polling a moving
// spinner at 0.6s and aliasing onto the `·` frame. Ground truth (live session):
// the glyph rotates through the set at 2 Hz — one frame every 500 ms.
assert.equal(
	LOADER_INTERVAL_MS,
	500,
	"live spinner advances one frame every 500 ms (2 Hz), matching Claude Code",
);

// --- The live glyph animates; it is not pinned to `·` -----------------------
const cycle = Array.from({ length: 12 }, (_, frame) => glyphAtFrame(frame));
assert.equal(cycle[0], "·", "the rotation starts on the `·` frame");
assert.ok(
	new Set(cycle).size >= 5,
	"the live glyph rotates through the glyph set rather than freezing on one frame",
);
assert.equal(
	glyphAtFrame(4),
	"✻",
	"`✻` is a live rotation frame (the mis-capture that pinned the glyph to `·` was a polling alias)",
);

console.log("spinner-cadence: ok");
