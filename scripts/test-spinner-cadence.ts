import assert from "node:assert/strict";

import { Loader } from "@earendil-works/pi-tui";

// Importing spinner.ts monkey-patches Loader.prototype (start/stop/updateDisplay)
// and exposes the captured live-spinner cadence.
const {
	LOADER_INTERVAL_MS,
	SHIMMER_PLATEAU_MS,
	shimmerBase,
	shimmerSweep,
	colorizeShimmerVerb,
	shimmerGlyphAnsi,
} = await import("../extensions/spinner.ts");

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

// --- CLFY-27: the thinking-spinner shimmer ----------------------------------
// Capture trajectory: docs/plans/2026-07-17-cc-thinking-surfaces.md.

// Base hue escalates one-way salmon → gold, turning bold, then plateaus.
assert.deepEqual(shimmerBase(0), { fg: "\x1b[38;5;174m", bold: false }, "0s is salmon, not bold");
assert.deepEqual(shimmerBase(10_000), { fg: "\x1b[38;5;174m", bold: false }, "still salmon at 10s");
assert.deepEqual(shimmerBase(13_500), { fg: "\x1b[38;5;180m", bold: false }, "warms to tan by ~13s");
assert.deepEqual(shimmerBase(16_000), { fg: "\x1b[38;5;215m", bold: false }, "orange by ~15-17s, not yet bold");
assert.deepEqual(shimmerBase(18_000), { fg: "\x1b[38;5;215m", bold: true }, "bold turns on by ~17s");
assert.deepEqual(shimmerBase(25_000), { fg: "\x1b[38;5;220m", bold: true }, "gold + bold at the plateau");
assert.deepEqual(shimmerBase(120_000), shimmerBase(SHIMMER_PLATEAU_MS), "the escalation holds at the plateau, never cycling back");

// The sweep is a ~3-char window that moves right→left over the first ~15s, then stops.
const early = shimmerSweep(10, 0);
assert.deepEqual(early, { start: 8, end: 9 }, "the sweep begins at the right edge");
const later = shimmerSweep(10, 600); // 3 steps at 200ms/step → center moved 3 left
assert.ok(later && later.end < 9, "the sweep window moves leftward over time");
assert.equal(shimmerSweep(10, 15_000), null, "the sweep stops after ~15s");
assert.equal(shimmerSweep(10, 25_000), null, "no sweep at the gold plateau");
assert.equal(shimmerSweep(0, 1_000), null, "an empty verb has no sweep");

// colorizeShimmerVerb wraps the verb in the base color (+bold) and paints the sweep window.
const goldVerb = colorizeShimmerVerb("Forging…", 25_000);
assert.ok(goldVerb.startsWith("\x1b[1m\x1b[38;5;220m"), "at the plateau the verb is bold gold");
assert.ok(goldVerb.endsWith("\x1b[0m") && !goldVerb.includes("\x1b[38;5;216m"), "no sweep highlight at the plateau");
const salmonVerb = colorizeShimmerVerb("Forging…", 0);
assert.ok(salmonVerb.includes("\x1b[38;5;216m"), "during the sweep the highlight color appears");
assert.ok(salmonVerb.includes("\x1b[38;5;174m"), "the un-highlighted chars keep the salmon base");
assert.equal(salmonVerb.replace(ANSI_RE, ""), "Forging…", "colorizing changes only color, not the text");

// The glyph shares the escalated base hue (and bold) with the verb.
assert.equal(shimmerGlyphAnsi(0), "\x1b[38;5;174m", "glyph is salmon early");
assert.equal(shimmerGlyphAnsi(25_000), "\x1b[1m\x1b[38;5;220m", "glyph is bold gold at the plateau");

console.log("spinner-cadence: ok");
