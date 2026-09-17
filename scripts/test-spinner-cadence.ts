import assert from "node:assert/strict";

import { Loader } from "@earendil-works/pi-tui";

// Importing spinner.ts monkey-patches Loader.prototype (start/stop/updateDisplay)
// and exposes the captured live-spinner cadence.
const {
	default: registerSpinner,
	LOADER_INTERVAL_MS,
	activeThinkingProgressPhrase,
	shimmerBaseRgb,
	shimmerPhase,
	shimmerBreatheFactor,
	shimmerSweep,
	colorizeShimmerVerb,
	shimmerGlyphAnsi,
	shimmerHighlightRgb,
	shimmerElapsedMs,
	thinkingProgressPhrase,
	OutputTokenTracker,
	sanitizeSpinnerVerbs,
} = await import("../extensions/spinner.ts");

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const identity = (text: string): string => text;

// A minimal UI stub: the patched updateDisplay only needs requestRender + a
// falsy `stopped`/`theme`. No real terminal is involved.
const ui = { requestRender(): void {}, stopped: false, theme: undefined } as any;
const bootstrapEvents = new Map<string, Function[]>();
registerSpinner({ on(name: string, handler: Function) { bootstrapEvents.set(name, [...(bootstrapEvents.get(name) ?? []), handler]); } } as any);

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
for (const handler of bootstrapEvents.get("session_shutdown") ?? []) await handler({}, { hasUI: false, ui: {} });

// --- Thinking phrase escalation is effort-independent. ----------------------
// Frame-by-frame Claude 2.1.266 captures at low and medium effort use the same
// thresholds; only the suffix (`with low/medium effort`) differs.
assert.equal(thinkingProgressPhrase(11_999), "thinking");
assert.equal(thinkingProgressPhrase(12_000), "still thinking");
assert.equal(thinkingProgressPhrase(22_000), "thinking more");
assert.equal(thinkingProgressPhrase(32_000), "thinking some more");
assert.equal(thinkingProgressPhrase(47_000), "almost done thinking");
assert.equal(activeThinkingProgressPhrase(99_000, 100_000), "thinking", "a thinking spell starts its phrase clock at thinking_start, not at an older request start");

// --- Provider-reported output tokens, cumulative across tool rounds. ---------
const tokens = new OutputTokenTracker();
tokens.resetRequest();
assert.equal(tokens.total(), 0);
assert.equal(tokens.update({ partial: { usage: { output: 12 } } }), true);
assert.equal(tokens.total(), 12, "streaming usage is cumulative, not added per event");
assert.equal(tokens.update({ partial: { usage: { output: 20 } } }), true);
assert.equal(tokens.total(), 20);
assert.equal(tokens.update({ partial: { usage: { output: 20 } } }), false, "duplicate cumulative usage is ignored");
assert.equal(tokens.update({ partial: { usage: { output: 3 } } }), false, "a regressing stream sample cannot lower the high-water mark");
assert.equal(tokens.total(), 20);
assert.equal(tokens.finish({ usage: { output: 0 } }), true);
assert.equal(tokens.total(), 20, "a lower final count cannot erase the streaming high-water mark");
assert.equal(tokens.finish({ usage: { output: 20 } }), false, "finish is idempotent within a turn");
assert.equal(tokens.total(), 20, "a duplicate message_end cannot settle the turn twice");
tokens.startTurn();
assert.equal(tokens.update({ message: { usage: { output: 7 } } }), true);
assert.equal(tokens.total(), 27, "next tool round adds to settled request usage");
tokens.finish({});
assert.equal(tokens.total(), 27, "missing final usage falls back to the last streamed value");
tokens.resetRequest();
assert.equal(tokens.update({ partial: {} }), false, "missing provider usage is omitted, never estimated from text");
assert.equal(tokens.total(), 0);

// Spinner verbs use grapheme boundaries too: truncation and ANSI coloring must
// never split modifiers, variation selectors, or a valid ZWJ sequence.
const emojiVerb = `${"a".repeat(47)}👩🏽‍🚀tail`;
assert.equal(sanitizeSpinnerVerbs([emojiVerb])[0], `${"a".repeat(47)}👩🏽‍🚀`);
assert.equal(sanitizeSpinnerVerbs(["❤️‍🔥", "🏳️‍🌈", "a\u200db", "bad\x1b[31mred"])[0], "❤️‍🔥");
assert.equal(sanitizeSpinnerVerbs(["a\u200db"])[0], "ab", "standalone joiners are removed from verbs");
assert.equal(sanitizeSpinnerVerbs(["bad\x1b[31mred"])[0], "badred", "terminal controls are removed from verbs");

// --- CLFY-27: the thinking-spinner shimmer (continuous sweep ⇄ breathe) -------
// Capture trajectory: docs/plans/2026-07-17-cc-thinking-surfaces.md. Claudify
// deliberately diverges from CC by never freezing; see that doc's Decision A.

// Base hue escalates one-way salmon → gold, turning bold, then holds.
assert.deepEqual(shimmerBaseRgb(0), { rgb: { r: 215, g: 135, b: 135 }, bold: false }, "0s is salmon, not bold");
assert.deepEqual(shimmerBaseRgb(10_000), { rgb: { r: 215, g: 135, b: 135 }, bold: false }, "still salmon at 10s");
assert.deepEqual(shimmerBaseRgb(13_500), { rgb: { r: 215, g: 175, b: 135 }, bold: false }, "warms to tan by ~13s");
assert.deepEqual(shimmerBaseRgb(18_000), { rgb: { r: 255, g: 175, b: 95 }, bold: true }, "orange + bold by ~17s");
assert.deepEqual(shimmerBaseRgb(25_000), { rgb: { r: 255, g: 215, b: 0 }, bold: true }, "gold + bold by ~20s");
assert.deepEqual(shimmerBaseRgb(120_000), shimmerBaseRgb(25_000), "the escalation holds, never cycling back");

// The overlay alternates sweep → breathe → sweep forever (4s + 3.2s = 7.2s cycle).
assert.equal(shimmerPhase(0), "sweep", "a cycle opens on the sweep");
assert.equal(shimmerPhase(3_000), "sweep", "still sweeping at 3s");
assert.equal(shimmerPhase(5_000), "breathe", "breathing after the sweep window");
assert.equal(shimmerPhase(7_300), "sweep", "the next cycle sweeps again — it never stops");

// The sweep is a ~3-char window moving right→left; absent during the breathe phase.
assert.deepEqual(shimmerSweep(10, 0), { start: 8, end: 9 }, "the sweep begins at the right edge");
const later = shimmerSweep(10, 600); // 3 steps at 200ms/step → center moved left
assert.ok(later && later.end < 9, "the sweep window moves leftward over time");
assert.equal(shimmerSweep(10, 5_000), null, "no sweep during the breathe phase");
assert.deepEqual(shimmerSweep(10, 7_200), { start: 8, end: 9 }, "the sweep returns on the next cycle");
assert.equal(shimmerSweep(0, 1_000), null, "an empty verb has no sweep");

// Breathing dims the whole verb during the breathe phase, and is neutral while sweeping.
assert.equal(shimmerBreatheFactor(1_000), 1, "no breathing during the sweep phase");
const dim = shimmerBreatheFactor(4_000 + 800); // ~half a breath into the breathe phase
assert.ok(dim < 1 && dim >= 0.55, "the breath dims within [0.55, 1)");

// colorizeShimmerVerb: captured time-varying highlight + base, text preserved.
const salmonVerb = colorizeShimmerVerb("Forging…", 0);
assert.ok(salmonVerb.includes("\x1b[38;2;255;135;135m"), "the early sweep uses captured xterm-216 red-salmon");
assert.ok(salmonVerb.includes("\x1b[38;2;215;135;135m"), "un-highlighted chars keep the salmon base");
assert.equal(salmonVerb.replace(ANSI_RE, ""), "Forging…", "colorizing changes only color, not the text");
// 21_600 = start of a cycle (pos 0 → sweep at the right edge) and past the 20s gold plateau.
const goldSweep = colorizeShimmerVerb("Forging…", 21_600);
assert.ok(goldSweep.startsWith("\x1b[1m") && goldSweep.includes("\x1b[38;2;255;215;95m"), "the gold sweep tracks the base with captured xterm-221");
assert.deepEqual(shimmerHighlightRgb(13_000), { r: 215, g: 175, b: 175 });
assert.deepEqual(shimmerHighlightRgb(17_000), { r: 215, g: 215, b: 135 });

// The glyph shares the breathed base hue (and bold) with the verb.
assert.equal(shimmerGlyphAnsi(0), "\x1b[38;2;215;135;135m", "glyph is salmon early");
assert.equal(shimmerGlyphAnsi(25_000), "\x1b[1m\x1b[38;2;255;215;0m", "glyph is bold gold at the plateau");

function fakePi() {
	const events = new Map<string, Function[]>();
	return { events, pi: { on(name: string, handler: Function) { events.set(name, [...(events.get(name) ?? []), handler]); } } as any };
}
const parentSpinner = fakePi();
const childSpinner = fakePi();
registerSpinner(parentSpinner.pi);
registerSpinner(childSpinner.pi);
const spinnerCtx = { hasUI: true, ui: { theme: undefined, setWorkingMessage() {} } };
for (const handler of parentSpinner.events.get("turn_start") ?? []) await handler({}, spinnerCtx);
assert.ok(shimmerElapsedMs() >= 0, "parent turn activates shimmer state");
for (const handler of childSpinner.events.get("turn_start") ?? []) await handler({}, spinnerCtx);
for (const handler of childSpinner.events.get("turn_end") ?? []) await handler({}, spinnerCtx);
assert.ok(shimmerElapsedMs() >= 0, "child turn completion cannot clear a still-active parent shimmer");
for (const handler of childSpinner.events.get("session_shutdown") ?? []) await handler({}, spinnerCtx);
for (const handler of parentSpinner.events.get("session_shutdown") ?? []) await handler({}, spinnerCtx);

console.log("spinner-cadence: ok");
