import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";

import { testedPiPatchBroker } from "./adapters/tested-pi/patch-broker.ts";
import { parseCompatibilityConfig, resolveCompatibilityFeatureEnabled } from "./domain/compatibility.ts";
import { deferGenerationRelease } from "./lifecycle/generation-handoff.ts";
import { resolveSpinnerShimmer } from "./presentation-profile.ts";
import { parseProfilePreference } from "./runtime/capabilities.ts";
import { readSettings } from "./settings.ts";
import { sanitizeToolContent } from "./terminal-sanitize.ts";

// Structural compatibility controls are re-read by each extension generation.
// The stable Loader wrapper below resolves its active hooks through global
// state, so `/reload` can turn the feature into a native pass-through without
// stacking another prototype patch.
function spinnerFeatureEnabled(): boolean {
	const profile = parseProfilePreference(process.env.PI_CLAUDIFY_PROFILE);
	if (profile === "portable" || profile === "certified-host") return false;
	return resolveCompatibilityFeatureEnabled(parseCompatibilityConfig(readSettings().values.compatibility), "spinner");
}

// ---------------------------------------------------------------------------
// Patch built-in Loader with Claude/OpenBrawd-style glyphs.
// Keep animation cadence constant so the spinner doesn't appear to slow down
// or freeze as the session grows.
// ---------------------------------------------------------------------------

const RAW_ANSI_RE = /\x1b\[[0-9;]*m/;
const RESET = "\x1b[0m";

// Defaults match the previous hardcoded values so behavior is identical
// when no theme is available or themeAdaptive=false. `applyThemeColors`
// below re-derives them from the active pi theme each tick.
let CLAUDE_ORANGE = "\x1b[38;2;215;119;87m";
let STATUS_DIM = "\x1b[38;2;153;153;153m";

// Short TTL so Claudify screen spinner changes are picked up within ~1s
// without re-reading the file on every 250ms spinner tick.
type SpinnerVerbMode = "append" | "replace";
interface SpinnerSettings {
	adaptive: boolean;
	verbColor: string;
	statusColor: string;
	verbs: readonly string[];
	shimmer: boolean;
}

let _spinnerSettingsCache: { value: SpinnerSettings; expires: number } | null = null;
const SPINNER_SETTINGS_TTL_MS = 1_000;
export const MAX_CUSTOM_SPINNER_VERBS = 200;
export const MAX_SPINNER_VERB_LENGTH = 48;
const spinnerGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
// Cross-extension bust signal: the Claudify screen in index.ts bumps this
// counter and we drop the cache when it changes.
const SPINNER_BUST_KEY = Symbol.for("pi-claudify:spinner-settings-bust");
const SPINNER_COLOR_PREVIEW_KEY = Symbol.for("pi-claudify:spinner-color-preview");
const SPINNER_STATUS_COLOR_PREVIEW_KEY = Symbol.for("pi-claudify:spinner-status-color-preview");
let _spinnerLastBust = 0;

function sanitizeSpinnerVerb(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const cleaned = sanitizeToolContent(value).trim();
	if (!cleaned) return null;
	const graphemes = Array.from(spinnerGraphemeSegmenter.segment(cleaned), ({ segment }) => segment);
	return graphemes.slice(0, MAX_SPINNER_VERB_LENGTH).join("");
}

export function sanitizeSpinnerVerbs(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const verbs: string[] = [];
	for (const item of value) {
		const verb = sanitizeSpinnerVerb(item);
		if (!verb) continue;
		const key = verb.toLocaleLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		verbs.push(verb);
		if (verbs.length >= MAX_CUSTOM_SPINNER_VERBS) break;
	}
	return verbs;
}

export function resolveSpinnerVerbs(customVerbs: readonly string[] | null, mode: SpinnerVerbMode): readonly string[] {
	if (!customVerbs || customVerbs.length === 0) return DEFAULT_SPINNER_VERBS;
	if (mode === "replace") return customVerbs;
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const verb of [...DEFAULT_SPINNER_VERBS, ...customVerbs]) {
		const key = verb.toLocaleLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(verb);
	}
	return merged.length > 0 ? merged : DEFAULT_SPINNER_VERBS;
}

function readSpinnerSettings(): SpinnerSettings {
	const now = Date.now();
	const bust = ((globalThis as any)[SPINNER_BUST_KEY] as number | undefined) ?? 0;
	if (bust !== _spinnerLastBust) {
		_spinnerLastBust = bust;
		_spinnerSettingsCache = null;
	}
	if (_spinnerSettingsCache && _spinnerSettingsCache.expires > now) {
		return _spinnerSettingsCache.value;
	}
	const raw = readSettings().values;
	const adaptive = raw.themeAdaptive !== false;
	const spinnerPreview = (globalThis as any)[SPINNER_COLOR_PREVIEW_KEY];
	const statusPreview = (globalThis as any)[SPINNER_STATUS_COLOR_PREVIEW_KEY];
	// Spinner glyph and verb share one theme color so they read as a single working indicator.
	const verbColor = typeof spinnerPreview === "string" && spinnerPreview.length > 0
		? spinnerPreview
		: typeof raw.spinnerColor === "string" && raw.spinnerColor.length > 0
			? raw.spinnerColor
			: "borderAccent";
	const statusColor = typeof statusPreview === "string" && statusPreview.length > 0
		? statusPreview
		: typeof raw.spinnerStatusColor === "string" && raw.spinnerStatusColor.length > 0
			? raw.spinnerStatusColor
			: "muted";
	const customVerbs = Array.isArray(raw.spinnerVerbs) ? sanitizeSpinnerVerbs(raw.spinnerVerbs) : null;
	const verbMode: SpinnerVerbMode = raw.spinnerVerbMode === "replace" ? "replace" : "append";
	// CC's warm shimmer imposes its own fixed palette, so it only applies when the
	// spinner is at its default color — a custom spinnerColor (or a live preview of
	// one) means the user picked a static color and wins. Opt-out via spinnerShimmer.
	const shimmer = resolveSpinnerShimmer(raw) && verbColor === "borderAccent";
	const value: SpinnerSettings = {
		adaptive,
		verbColor,
		statusColor,
		verbs: resolveSpinnerVerbs(customVerbs, verbMode),
		shimmer,
	};
	_spinnerSettingsCache = { value, expires: now + SPINNER_SETTINGS_TTL_MS };
	return value;
}

// Original Claude-style values restored when the user turns adaptive off.
const _DEFAULT_CLAUDE_ORANGE = "\x1b[38;2;215;119;87m";
const _DEFAULT_STATUS_DIM = "\x1b[38;2;153;153;153m";

let _themeColorsCacheTheme: unknown = null;
let _themeColorsLastAdaptive: boolean | null = null;
let _themeColorsLastVerbKey: string | null = null;
let _themeColorsLastStatusKey: string | null = null;

function resolveThemeColor(theme: any, key: string, fallbackKey: string): string | null {
	if (!theme || typeof theme.getFgAnsi !== "function") return null;
	try {
		const v = theme.getFgAnsi(key);
		if (typeof v === "string" && v.length > 0) return v;
	} catch { /* ignore */ }
	if (fallbackKey !== key) {
		try {
			const v = theme.getFgAnsi(fallbackKey);
			if (typeof v === "string" && v.length > 0) return v;
		} catch { /* ignore */ }
	}
	return null;
}

// ---------------------------------------------------------------------------
// CLFY-27: Claude Code's thinking-spinner shimmer, extended to a continuous loop.
// The warm hue escalation (salmon → gold) is captured from CC
// (docs/plans/2026-07-17-cc-thinking-surfaces.md); CC then freezes at gold.
// Claudify deliberately diverges (Berto's call): the animation never stops — on
// top of the escalated base color it alternates a right→left sweep with a
// whole-verb "breathing" pulse, forever. pi repaints on every setWorkingMessage
// (setMessage → updateDisplay → requestRender), so this animates at the refresh
// cadence, independent of the 500ms glyph timer.
const SHIMMER_BOLD = "\x1b[1m";

interface Rgb { readonly r: number; readonly g: number; readonly b: number; }
interface ShimmerStop { readonly atMs: number; readonly rgb: Rgb; readonly bold: boolean; }
// Warm escalation, keyed to elapsed seconds (captured at effort=high on CC 2.1.212).
const SHIMMER_STOPS: readonly ShimmerStop[] = [
	{ atMs: 0, rgb: { r: 215, g: 135, b: 135 }, bold: false }, // #D78787 salmon
	{ atMs: 13_000, rgb: { r: 215, g: 175, b: 135 }, bold: false }, // #D7AF87 tan
	{ atMs: 14_000, rgb: { r: 215, g: 175, b: 95 }, bold: false }, // #D7AF5F
	{ atMs: 15_000, rgb: { r: 255, g: 175, b: 95 }, bold: false }, // #FFAF5F orange
	{ atMs: 17_000, rgb: { r: 255, g: 175, b: 95 }, bold: true }, // + bold
	{ atMs: 20_000, rgb: { r: 255, g: 215, b: 0 }, bold: true }, // #FFD700 gold
];
// The sweep highlight warms with the base rather than staying one fixed cream.
// Stops are exact RGB equivalents of xterm colors observed in low/medium frames.
const SHIMMER_HIGHLIGHT_STOPS: readonly Omit<ShimmerStop, "bold">[] = [
	{ atMs: 0, rgb: { r: 255, g: 135, b: 135 } }, // xterm 216
	{ atMs: 13_000, rgb: { r: 215, g: 175, b: 175 } }, // xterm 181
	{ atMs: 14_000, rgb: { r: 215, g: 175, b: 135 } }, // xterm 180
	{ atMs: 15_000, rgb: { r: 215, g: 215, b: 175 } }, // xterm 187
	{ atMs: 17_000, rgb: { r: 215, g: 215, b: 135 } }, // xterm 186
	{ atMs: 20_000, rgb: { r: 255, g: 215, b: 95 } }, // xterm 221
];

export function shimmerHighlightRgb(elapsedMs: number): Rgb {
	let stop = SHIMMER_HIGHLIGHT_STOPS[0];
	for (const candidate of SHIMMER_HIGHLIGHT_STOPS) {
		if (elapsedMs >= candidate.atMs) stop = candidate;
		else break;
	}
	return stop.rgb;
}

// One animation super-cycle: a sweep pass, then a breathing stretch, repeating.
const SHIMMER_SWEEP_MS = 4_000;
const SHIMMER_BREATHE_MS = 3_200;
const SHIMMER_CYCLE_MS = SHIMMER_SWEEP_MS + SHIMMER_BREATHE_MS;
const SHIMMER_SWEEP_STEP_MS = 200; // ~5 char-steps/s
const SHIMMER_BREATH_PERIOD_MS = 1_600;
const SHIMMER_BREATHE_MIN = 0.55; // dimmest fraction of base brightness within a breath
// Refresh cadence while the animation runs — smooth enough for the sweep + breath.
export const SHIMMER_REFRESH_MS = 200;

function rgbAnsi({ r, g, b }: Rgb): string {
	return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
}
function scaleRgb({ r, g, b }: Rgb, factor: number): Rgb {
	return { r: r * factor, g: g * factor, b: b * factor };
}

/** Base verb/glyph color (RGB) + bold for the elapsed time — the one-way "wave". */
export function shimmerBaseRgb(elapsedMs: number): { rgb: Rgb; bold: boolean } {
	let stop = SHIMMER_STOPS[0];
	for (const candidate of SHIMMER_STOPS) {
		if (elapsedMs >= candidate.atMs) stop = candidate;
		else break;
	}
	return { rgb: stop.rgb, bold: stop.bold };
}

/** Which overlay is active now — the sweep, or the breathing pulse. They alternate forever. */
export function shimmerPhase(elapsedMs: number): "sweep" | "breathe" {
	return (elapsedMs % SHIMMER_CYCLE_MS) < SHIMMER_SWEEP_MS ? "sweep" : "breathe";
}

/** Brightness fraction of the breathing pulse: 1.0 (bright) dipping to SHIMMER_BREATHE_MIN and back. 1.0 during the sweep phase. */
export function shimmerBreatheFactor(elapsedMs: number): number {
	const pos = ((elapsedMs % SHIMMER_CYCLE_MS) + SHIMMER_CYCLE_MS) % SHIMMER_CYCLE_MS;
	if (pos < SHIMMER_SWEEP_MS) return 1;
	const t = (pos - SHIMMER_SWEEP_MS) % SHIMMER_BREATH_PERIOD_MS;
	const dip = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / SHIMMER_BREATH_PERIOD_MS); // 0 → 1 → 0
	return 1 - (1 - SHIMMER_BREATHE_MIN) * dip;
}

/** Inclusive [start,end] char indices of the sweep highlight, or null (breathe phase / pass complete). */
export function shimmerSweep(verbLen: number, elapsedMs: number): { start: number; end: number } | null {
	if (verbLen <= 0 || elapsedMs < 0) return null;
	const pos = elapsedMs % SHIMMER_CYCLE_MS;
	if (pos >= SHIMMER_SWEEP_MS) return null; // breathing, not sweeping
	const step = Math.floor(pos / SHIMMER_SWEEP_STEP_MS);
	if (step >= verbLen) return null; // pass complete — hold uniform until the breathe phase
	const center = verbLen - 1 - step; // right → left
	return { start: Math.max(0, center - 1), end: Math.min(verbLen - 1, center + 1) };
}

/** Wrap the verb in the escalated base color (breathing when in that phase) with the sweep highlight. */
export function colorizeShimmerVerb(verb: string, elapsedMs: number): string {
	const chars = Array.from(spinnerGraphemeSegmenter.segment(verb), ({ segment }) => segment);
	const { rgb, bold } = shimmerBaseRgb(elapsedMs);
	const boldSeq = bold ? SHIMMER_BOLD : "";
	const baseAnsi = rgbAnsi(scaleRgb(rgb, shimmerBreatheFactor(elapsedMs)));
	const sweep = shimmerSweep(chars.length, elapsedMs);
	if (!sweep) return `${boldSeq}${baseAnsi}${verb}${RESET}`;
	const hlAnsi = rgbAnsi(shimmerHighlightRgb(elapsedMs));
	let out = boldSeq;
	for (let i = 0; i < chars.length; i++) {
		out += (i >= sweep.start && i <= sweep.end ? hlAnsi : baseAnsi) + chars[i];
	}
	return `${out}${RESET}`;
}

/** Leading-glyph color — the breathed base (+bold), matching the verb. */
export function shimmerGlyphAnsi(elapsedMs: number): string {
	const { rgb, bold } = shimmerBaseRgb(elapsedMs);
	const ansi = rgbAnsi(scaleRgb(rgb, shimmerBreatheFactor(elapsedMs)));
	return `${bold ? SHIMMER_BOLD : ""}${ansi}`;
}

interface ShimmerOwnerState { anchorMs: number; enabled: boolean }
const SHIMMER_SURFACE = "spinner-shimmer";
const DEFAULT_SHIMMER_STATE: ShimmerOwnerState = { anchorMs: 0, enabled: false };
function shimmerState(owner?: object): ShimmerOwnerState {
	if (!owner) return testedPiPatchBroker.active<ShimmerOwnerState>(SHIMMER_SURFACE) ?? DEFAULT_SHIMMER_STATE;
	let value = testedPiPatchBroker.owned<ShimmerOwnerState>(owner, SHIMMER_SURFACE);
	if (!value) {
		value = { anchorMs: 0, enabled: false };
		testedPiPatchBroker.bind(owner, SHIMMER_SURFACE, value);
	}
	return value;
}
function isActiveShimmerOwner(owner: object): boolean {
	return testedPiPatchBroker.active<ShimmerOwnerState>(SHIMMER_SURFACE) === testedPiPatchBroker.owned<ShimmerOwnerState>(owner, SHIMMER_SURFACE);
}
export function shimmerElapsedMs(): number {
	const anchor = shimmerState().anchorMs;
	return anchor > 0 ? Date.now() - anchor : -1;
}
function shimmerActive(): boolean {
	const current = shimmerState();
	return current.enabled && current.anchorMs > 0;
}

function applyThemeColors(theme: any, owner?: object): void {
	const settings = readSpinnerSettings();
	const { adaptive, verbColor, statusColor } = settings;
	shimmerState(owner).enabled = settings.shimmer;
	if (owner && !isActiveShimmerOwner(owner)) return;

	// Respond to runtime toggles (themeAdaptive or spinner color key changes)
	// without restarting pi.
	const settingsChanged = _themeColorsLastAdaptive !== adaptive
		|| _themeColorsLastVerbKey !== verbColor
		|| _themeColorsLastStatusKey !== statusColor;
	if (settingsChanged) {
		_themeColorsLastAdaptive = adaptive;
		_themeColorsLastVerbKey = verbColor;
		_themeColorsLastStatusKey = statusColor;
		_themeColorsCacheTheme = null;
		if (!adaptive) {
			CLAUDE_ORANGE = _DEFAULT_CLAUDE_ORANGE;
			STATUS_DIM = _DEFAULT_STATUS_DIM;
		}
	}

	if (!theme || !adaptive) return;
	if (_themeColorsCacheTheme === theme) return;
	_themeColorsCacheTheme = theme;

	const verb = resolveThemeColor(theme, verbColor, "accent");
	if (verb) CLAUDE_ORANGE = verb;
	const status = resolveThemeColor(theme, statusColor, "muted");
	if (status) STATUS_DIM = status;
}

// Match OpenBrawd's spinner glyph set, with the final Ghostty frame restored
// to ✽ because the user's font-codepoint-map now centers it correctly.
function getDefaultSpinnerCharacters(): string[] {
	if (process.env.TERM === "xterm-ghostty") {
		return ["·", "✢", "✳", "✶", "✻", "✽"];
	}
	return process.platform === "darwin"
		? ["·", "✢", "✳", "✶", "✻", "✽"]
		: ["·", "✢", "*", "✶", "✻", "✽"];
}

const SPINNER_CHARS = getDefaultSpinnerCharacters();
const OB_FRAMES = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse()];
// Claude Code advances its live spinner glyph at 2 Hz (one frame every 500 ms),
// captured from a real session — CLFY-8. The inherited OpenBrawd cadence was
// 250 ms (4 Hz), which read twice as fast. The glyph set/bounce is unchanged;
// only the frame interval is corrected.
export const LOADER_INTERVAL_MS = 500;
const LOADER_LAST_TEXT = Symbol.for("pi-claudify:loader-last-text");
const LOADER_ACTIVE = Symbol.for("pi-claudify:loader-active");
const LOADER_GENERATION = Symbol.for("pi-claudify:loader-generation");
const ACTIVE_UI_SYMBOL = Symbol.for("pi-claudify:active-ui");

function getLoaderIntervalMs(_loader: any): number {
	return LOADER_INTERVAL_MS;
}

function unrefTimer(timer: ReturnType<typeof setTimeout> | null | undefined): void {
	(timer as any)?.unref?.();
}

interface LoaderPatchHooks {
	updateDisplay(this: any): void;
	start(this: any): void;
	stop(this: any): void;
}
interface LoaderPatchRegistry {
	original: LoaderPatchHooks;
}
const LOADER_PATCH_REGISTRY_KEY = Symbol.for("pi-claudify:spinner-loader-patch-registry");
const LOADER_PATCH_SURFACE = "spinner-loader";

function customUpdateDisplay(this: any): void {
	applyThemeColors(this.ui?.theme);
	const frame = OB_FRAMES[this.currentFrame % OB_FRAMES.length];
	const message = typeof this.message === "string" && RAW_ANSI_RE.test(this.message)
		? this.message
		: this.messageColorFn(this.message);
	const glyphColor = shimmerActive() ? shimmerGlyphAnsi(shimmerElapsedMs()) : CLAUDE_ORANGE;
	const nextText = `${glyphColor}${frame}${RESET} ${message}`;
	if (this[LOADER_LAST_TEXT] === nextText) return;
	this[LOADER_LAST_TEXT] = nextText;
	this.setText(nextText);
	if (this.ui && !this.ui.stopped) {
		(globalThis as any)[ACTIVE_UI_SYMBOL] = this.ui;
		this.ui.requestRender();
	}
}

function customStart(this: any): void {
	this.stop();
	this[LOADER_ACTIVE] = true;
	const generation = (this[LOADER_GENERATION] ?? 0) + 1;
	this[LOADER_GENERATION] = generation;
	delete this[LOADER_LAST_TEXT];
	this.updateDisplay();
	const scheduleNext = () => {
		if (this[LOADER_ACTIVE] !== true || this[LOADER_GENERATION] !== generation) return;
		const timer = setTimeout(() => {
			this.intervalId = null;
			if (this[LOADER_ACTIVE] !== true || this[LOADER_GENERATION] !== generation) return;
			this.currentFrame = (this.currentFrame + 1) % OB_FRAMES.length;
			this.updateDisplay();
			scheduleNext();
		}, getLoaderIntervalMs(this));
		unrefTimer(timer);
		this.intervalId = timer;
	};
	scheduleNext();
}

function customStop(this: any): void {
	this[LOADER_ACTIVE] = false;
	this[LOADER_GENERATION] = (this[LOADER_GENERATION] ?? 0) + 1;
	if (this.intervalId) {
		clearTimeout(this.intervalId);
		this.intervalId = null;
	}
}

function installSpinnerLoaderPatch(owner: object): void {
	const root = globalThis as Record<PropertyKey, unknown>;
	let registry = root[LOADER_PATCH_REGISTRY_KEY] as LoaderPatchRegistry | undefined;
	if (!registry) {
		registry = {
			original: {
				updateDisplay: (Loader.prototype as any).updateDisplay,
				start: Loader.prototype.start,
				stop: Loader.prototype.stop,
			},
		};
		root[LOADER_PATCH_REGISTRY_KEY] = registry;
		for (const method of ["updateDisplay", "start", "stop"] as const) {
			(Loader.prototype as any)[method] = function stableSpinnerLoaderMethod(this: any, ...args: any[]) {
				const active = testedPiPatchBroker.active<LoaderPatchHooks>(LOADER_PATCH_SURFACE);
				return (active?.[method] ?? registry!.original[method]).call(this, ...args as []);
			};
		}
	}
	testedPiPatchBroker.bind(owner, LOADER_PATCH_SURFACE, { updateDisplay: customUpdateDisplay, start: customStart, stop: customStop });
}

// ---------------------------------------------------------------------------
// Spinner verbs — fun/whimsical loading messages (different set from OpenBrawd)
// ---------------------------------------------------------------------------

export const DEFAULT_SPINNER_VERBS = [
	"Accomplishing",
	"Actioning",
	"Actualizing",
	"Architecting",
	"Baking",
	"Beaming",
	"Beboppin'",
	"Befuddling",
	"Billowing",
	"Blanching",
	"Bloviating",
	"Boogieing",
	"Boondoggling",
	"Booping",
	"Bootstrapping",
	"Brewing",
	"Bunning",
	"Burrowing",
	"Calculating",
	"Canoodling",
	"Caramelizing",
	"Cascading",
	"Catapulting",
	"Cerebrating",
	"Channeling",
	"Choreographing",
	"Churning",
	"Coalescing",
	"Cogitating",
	"Combobulating",
	"Composing",
	"Computing",
	"Concocting",
	"Considering",
	"Contemplating",
	"Cooking",
	"Crafting",
	"Creating",
	"Crunching",
	"Crystallizing",
	"Cultivating",
	"Deciphering",
	"Deliberating",
	"Determining",
	"Dilly-dallying",
	"Discombobulating",
	"Doodling",
	"Drizzling",
	"Ebbing",
	"Effecting",
	"Elucidating",
	"Embellishing",
	"Enchanting",
	"Envisioning",
	"Evaporating",
	"Fermenting",
	"Fiddle-faddling",
	"Finagling",
	"Flambéing",
	"Flibbertigibbeting",
	"Flowing",
	"Flummoxing",
	"Fluttering",
	"Forging",
	"Forming",
	"Frolicking",
	"Frosting",
	"Gallivanting",
	"Galloping",
	"Garnishing",
	"Generating",
	"Gesticulating",
	"Germinating",
	"Grooving",
	"Gusting",
	"Harmonizing",
	"Hashing",
	"Hatching",
	"Herding",
	"Hullaballooing",
	"Hyperspacing",
	"Ideating",
	"Imagining",
	"Improvising",
	"Incubating",
	"Inferring",
	"Infusing",
	"Ionizing",
	"Jitterbugging",
	"Julienning",
	"Kneading",
	"Leavening",
	"Levitating",
	"Lollygagging",
	"Manifesting",
	"Marinating",
	"Meandering",
	"Metamorphosing",
	"Misting",
	"Moonwalking",
	"Moseying",
	"Mulling",
	"Mustering",
	"Musing",
	"Nebulizing",
	"Nesting",
	"Noodling",
	"Nucleating",
	"Orbiting",
	"Orchestrating",
	"Osmosing",
	"Perambulating",
	"Percolating",
	"Perusing",
	"Philosophising",
	"Photosynthesizing",
	"Pollinating",
	"Pondering",
	"Pontificating",
	"Pouncing",
	"Precipitating",
	"Prestidigitating",
	"Processing",
	"Proofing",
	"Propagating",
	"Puttering",
	"Puzzling",
	"Quantumizing",
	"Razzle-dazzling",
	"Razzmatazzing",
	"Recombobulating",
	"Reticulating",
	"Roosting",
	"Ruminating",
	"Sautéing",
	"Scampering",
	"Schlepping",
	"Scurrying",
	"Seasoning",
	"Shenaniganing",
	"Shimmying",
	"Simmering",
	"Skedaddling",
	"Sketching",
	"Slithering",
	"Smooshing",
	"Sock-hopping",
	"Spelunking",
	"Spinning",
	"Sprouting",
	"Stewing",
	"Sublimating",
	"Swirling",
	"Swooping",
	"Symbioting",
	"Synthesizing",
	"Tempering",
	"Thinking",
	"Thundering",
	"Tinkering",
	"Tomfoolering",
	"Topsy-turvying",
	"Transfiguring",
	"Transmuting",
	"Twisting",
	"Undulating",
	"Unfurling",
	"Unravelling",
	"Vibing",
	"Waddling",
	"Wandering",
	"Warping",
	"Whatchamacalliting",
	"Whirlpooling",
	"Whirring",
	"Whisking",
	"Wibbling",
	"Working",
	"Wrangling",
	"Zesting",
	"Zigzagging",
];

// ---------------------------------------------------------------------------
// Spinner glyph characters are now patched into the Loader above.
// No separate glyph prefix needed.
// ---------------------------------------------------------------------------

function pickVerb(): string {
	const verbs = readSpinnerSettings().verbs;
	return verbs[Math.floor(Math.random() * verbs.length)] ?? DEFAULT_SPINNER_VERBS[0];
}

/** Format elapsed ms as compact duration: 5s, 1m 23s, 1h 2m 3s */
function formatDuration(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function formatCount(value: number): string {
	return new Intl.NumberFormat("en-US").format(value);
}

function outputTokens(value: any): number | null {
	const output = value?.usage?.output;
	return typeof output === "number" && Number.isFinite(output) && output >= 0 ? output : null;
}

/** Provider-reported output tokens across all assistant messages in one request. */
export class OutputTokenTracker {
	private settled = 0;
	private streaming = 0;
	private turnFinished = false;

	resetRequest(): void {
		this.settled = 0;
		this.streaming = 0;
		this.turnFinished = false;
	}

	startTurn(): void {
		this.streaming = 0;
		this.turnFinished = false;
	}

	update(event: any): boolean {
		if (this.turnFinished) return false;
		const next = outputTokens(event?.partial ?? event?.message);
		if (next === null || next <= this.streaming) return false;
		this.streaming = next;
		return true;
	}

	finish(message: any): boolean {
		if (this.turnFinished) return false;
		this.turnFinished = true;
		const final = outputTokens(message) ?? 0;
		const turnTotal = Math.max(this.streaming, final);
		this.settled += turnTotal;
		this.streaming = 0;
		return turnTotal > 0;
	}

	total(): number {
		return this.settled + this.streaming;
	}
}

function statusText(text: string): string {
	return `${STATUS_DIM}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/** Threshold before showing elapsed time in status parentheses */
const SHOW_TIMER_AFTER_MS = 30_000;

/** How long to preserve "thought for Ns" across turns */
const THOUGHT_DISPLAY_MS = 3_500;

/** Minimum thinking duration before showing "thought for Ns" */
const MIN_THINKING_SHOW_MS = 100;

/** Message refresh cadence. Keep constant so status updates don't stall on long sessions. */
const WORKING_MESSAGE_INTERVAL_MS = 1_000;

/** Completion message linger */
const TURN_COMPLETION_MS = 2_500;

export function thinkingProgressPhrase(elapsedMs: number): "thinking" | "still thinking" | "thinking more" | "thinking some more" | "almost done thinking" {
	if (elapsedMs >= 47_000) return "almost done thinking";
	if (elapsedMs >= 32_000) return "thinking some more";
	if (elapsedMs >= 22_000) return "thinking more";
	if (elapsedMs >= 12_000) return "still thinking";
	return "thinking";
}

export function activeThinkingProgressPhrase(thinkingStartedAt: number, now: number): ReturnType<typeof thinkingProgressPhrase> {
	return thinkingProgressPhrase(thinkingStartedAt > 0 ? Math.max(0, now - thinkingStartedAt) : 0);
}

export interface SpinnerRuntimeAuthority { owner: object; isCurrent(): boolean }

export default function (pi: ExtensionAPI, supplied?: object | SpinnerRuntimeAuthority) {
	// Disabled generations register no event handlers. The process-stable Loader
	// wrapper installed above simultaneously has no active hooks and delegates to
	// the captured native implementation.
	if (!spinnerFeatureEnabled()) return;
	const authority = supplied && "owner" in supplied && typeof (supplied as SpinnerRuntimeAuthority).isCurrent === "function"
		? supplied as SpinnerRuntimeAuthority
		: undefined;
	const shimmerOwner = authority?.owner ?? supplied ?? {};
	let locallyCurrent = true;
	const isCurrent = () => locallyCurrent && (authority?.isCurrent() ?? true);
	installSpinnerLoaderPatch(shimmerOwner);
	const ownerShimmer = shimmerState(shimmerOwner);
	let agentStartTime = 0;
	let turnStartTime = 0;
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	let completionTimer: ReturnType<typeof setTimeout> | null = null;
	let thoughtStatusTimer: ReturnType<typeof setTimeout> | null = null;
	let currentVerb = "";
	const tokenTracker = new OutputTokenTracker();
	let thinkingStatus: "thinking" | number /* duration ms */ | null = null;
	let thinkingStartTime = 0;
	let thoughtForSetAt = 0;
	let activeTurnId = 0;
	let turnActive = false;
	let lastWorkingMessage: string | null = null;
	let activeCtx: { ui: any; hasUI: boolean } | null = null;

	function getEffortSuffix(): string {
		try {
			const level = pi.getThinkingLevel();
			if (!level || level === "off") return "";
			return ` with ${level} effort`;
		} catch {
			return "";
		}
	}

	function buildWorkingMessage(): string {
		const elapsed = Date.now() - (agentStartTime || turnStartTime);
		const tokenCount = tokenTracker.total();
		const statusParts: string[] = [];

		// Claude Code orders the status list duration → tokens → thinking, e.g.
		// "✽ Gathering the Fellowship… (3s · ↓ 162 tokens · thought for 1s)".
		if (elapsed > SHOW_TIMER_AFTER_MS || thinkingStatus !== null || tokenCount > 0) {
			statusParts.push(formatDuration(elapsed));
		}

		if (tokenCount > 0) {
			statusParts.push(`↓ ${formatCount(tokenCount)} tokens`);
		}

		if (thinkingStatus === "thinking") {
			statusParts.push(`${activeThinkingProgressPhrase(thinkingStartTime, Date.now())}${getEffortSuffix()}`);
		} else if (typeof thinkingStatus === "number") {
			statusParts.push(`thought for ${Math.max(1, Math.round(thinkingStatus / 1000))}s`);
		}

		let message = shimmerActive()
			? colorizeShimmerVerb(`${currentVerb}…`, elapsed)
			: `${CLAUDE_ORANGE}${currentVerb}…${RESET}`;
		if (statusParts.length > 0) {
			message += statusText(` (${statusParts.join(" · ")})`);
		}
		return message;
	}

	function syncWorkingMessage(force = false): void {
		// Anchor the shimmer to the same elapsed base buildWorkingMessage uses, so the
		// glyph (read from ownerShimmer.anchorMs in updateDisplay) tracks the verb's escalation.
		ownerShimmer.anchorMs = turnActive ? (agentStartTime || turnStartTime) : 0;
		if (!activeCtx?.hasUI) return;
		// Re-derive colors on every tick so Claudify screen color/status changes
		// take effect within ~250 ms without waiting for the next pi event.
		// applyThemeColors is identity-cached on (theme, spinnerKey, statusKey) so
		// this is cheap when nothing changed.
		applyThemeColors(activeCtx.ui?.theme, shimmerOwner);
		const nextMessage = buildWorkingMessage();
		if (!force && nextMessage === lastWorkingMessage) return;
		lastWorkingMessage = nextMessage;
		try {
			activeCtx.ui.setWorkingMessage(nextMessage);
		} catch { /* noop */ }
	}

	function restoreDefaultWorkingMessage(): void {
		lastWorkingMessage = null;
		if (!activeCtx?.hasUI) return;
		try {
			activeCtx.ui.setWorkingMessage();
		} catch { /* noop */ }
	}

	function getWorkingMessageIntervalMs(): number {
		const elapsed = Date.now() - (agentStartTime || turnStartTime);
		// The shimmer animates continuously (sweep ⇄ breathe), so refresh at the
		// animation cadence for as long as it's active.
		if (ownerShimmer.enabled && ownerShimmer.anchorMs > 0) {
			return SHIMMER_REFRESH_MS;
		}
		const tokenCount = tokenTracker.total();
		// Keep ticking once per second even when idle so Claudify screen changes
		// take effect within ~1s and elapsed-time crossover into the timer-on
		// state still fires close to 30s. syncWorkingMessage short-circuits
		// when the rendered string is unchanged, so the cost is negligible.
		if (thinkingStatus === null && tokenCount === 0 && elapsed <= SHOW_TIMER_AFTER_MS) {
			return Math.max(250, Math.min(WORKING_MESSAGE_INTERVAL_MS, SHOW_TIMER_AFTER_MS - elapsed + 1));
		}
		return Math.max(250, WORKING_MESSAGE_INTERVAL_MS - (elapsed % WORKING_MESSAGE_INTERVAL_MS));
	}

	function scheduleRefreshTick(): void {
		if (!turnActive || refreshTimer) return;
		const intervalMs = getWorkingMessageIntervalMs();
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			syncWorkingMessage();
			scheduleRefreshTick();
		}, intervalMs);
		unrefTimer(refreshTimer);
	}

	function startRefreshLoop(): void {
		stopRefreshLoop();
		syncWorkingMessage(true);
		scheduleRefreshTick();
	}

	function rescheduleRefreshLoop(): void {
		if (!turnActive) return;
		stopRefreshLoop();
		scheduleRefreshTick();
	}

	function stopRefreshLoop(): void {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
	}

	function clearCompletionTimer(): void {
		if (completionTimer) {
			clearTimeout(completionTimer);
			completionTimer = null;
		}
	}

	function clearThoughtStatusTimer(): void {
		if (thoughtStatusTimer) {
			clearTimeout(thoughtStatusTimer);
			thoughtStatusTimer = null;
		}
	}

	function scheduleThoughtStatusClear(): void {
		clearThoughtStatusTimer();
		if (typeof thinkingStatus !== "number") return;
		const remaining = THOUGHT_DISPLAY_MS - (Date.now() - thoughtForSetAt);
		if (remaining <= 0) {
			thinkingStatus = null;
			if (turnActive) syncWorkingMessage(true);
			else if (!completionTimer) restoreDefaultWorkingMessage();
			return;
		}
		thoughtStatusTimer = setTimeout(() => {
			thoughtStatusTimer = null;
			if (typeof thinkingStatus !== "number") return;
			if (Date.now() - thoughtForSetAt < THOUGHT_DISPLAY_MS) {
				scheduleThoughtStatusClear();
				return;
			}
			thinkingStatus = null;
			if (turnActive) syncWorkingMessage(true);
			else if (!completionTimer) restoreDefaultWorkingMessage();
		}, remaining);
		unrefTimer(thoughtStatusTimer);
	}

	function clearDisplay(): void {
		stopRefreshLoop();
		clearCompletionTimer();
		clearThoughtStatusTimer();
		ownerShimmer.anchorMs = 0;
		agentStartTime = 0;
		turnStartTime = 0;
		thinkingStatus = null;
		thoughtForSetAt = 0;
		tokenTracker.resetRequest();
		restoreDefaultWorkingMessage();
	}

	function onThinkingEnd(): void {
		if (thinkingStatus !== "thinking") return;
		const duration = Date.now() - thinkingStartTime;
		if (duration < MIN_THINKING_SHOW_MS) {
			thinkingStatus = null;
			clearThoughtStatusTimer();
			return;
		}
		thinkingStatus = duration;
		thoughtForSetAt = Date.now();
		scheduleThoughtStatusClear();
	}

	pi.on("before_agent_start", async () => {
		if (!isCurrent()) return;
		// Start once per top-level request. Steering/follow-up messages while the
		// agent is active must not reset the timer.
		if (!agentStartTime) agentStartTime = Date.now();
	});

	pi.on("agent_start", async () => {
		if (!isCurrent()) return;
		if (!agentStartTime) agentStartTime = Date.now();
		tokenTracker.resetRequest();
	});

	pi.on("turn_start", async (_event, ctx) => {
		if (!isCurrent()) return;
		activeTurnId++;
		turnActive = true;
		activeCtx = ctx;
		applyThemeColors(ctx.ui?.theme, shimmerOwner);
		turnStartTime = Date.now();
		if (!agentStartTime) agentStartTime = turnStartTime;
		currentVerb = pickVerb();
		tokenTracker.startTurn();
		clearCompletionTimer();
		if (typeof thinkingStatus !== "number" || Date.now() - thoughtForSetAt >= THOUGHT_DISPLAY_MS) {
			thinkingStatus = null;
			clearThoughtStatusTimer();
		} else {
			scheduleThoughtStatusClear();
		}
		startRefreshLoop();
	});

	pi.on("message_update", async (event, ctx) => {
		if (!isCurrent()) return;
		activeCtx = ctx;
		applyThemeColors(ctx.ui?.theme, shimmerOwner);
		const evt = event.assistantMessageEvent;
		let statusChanged = tokenTracker.update(evt);

		if (evt.type === "thinking_start") {
			clearThoughtStatusTimer();
			thinkingStatus = "thinking";
			thinkingStartTime = Date.now();
			statusChanged = true;
		}
		if (evt.type === "thinking_end") {
			onThinkingEnd();
			statusChanged = true;
		}

		if (statusChanged) {
			syncWorkingMessage(true);
			rescheduleRefreshLoop();
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (!isCurrent()) return;
		if (event.message?.role !== "assistant") return;
		if (tokenTracker.finish(event.message) && ctx.hasUI) syncWorkingMessage(true);
		// Abort/error streams do not always emit thinking_end.
		onThinkingEnd();
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!isCurrent()) return;
		turnActive = false;
		ownerShimmer.anchorMs = 0; // the "✻ Worked for …" completion line is not shimmered
		activeCtx = ctx;
		applyThemeColors(ctx.ui?.theme, shimmerOwner);
		const turnId = activeTurnId;
		const elapsed = Date.now() - (agentStartTime || turnStartTime);
		stopRefreshLoop();
		clearCompletionTimer();

		if (typeof thinkingStatus === "number" && Date.now() - thoughtForSetAt >= THOUGHT_DISPLAY_MS) {
			thinkingStatus = null;
			clearThoughtStatusTimer();
		}

		if (activeCtx?.hasUI) {
			const message = `${STATUS_DIM}✻ Worked for ${formatDuration(elapsed)}${RESET}`;
			lastWorkingMessage = message;
			try {
				activeCtx.ui.setWorkingMessage(message);
			} catch { /* noop */ }
			completionTimer = setTimeout(() => {
				completionTimer = null;
				if (activeTurnId !== turnId) return;
				restoreDefaultWorkingMessage();
			}, TURN_COMPLETION_MS);
			unrefTimer(completionTimer);
		} else if (typeof thinkingStatus !== "number") {
			restoreDefaultWorkingMessage();
		}

	});

	pi.on("agent_end", async () => {
		if (!isCurrent()) return;
		turnActive = false;
		agentStartTime = 0;
		// Preserve the just-finished "Worked for …" line. Pi emits agent_end
		// immediately after the final turn, so clearing here made the completion
		// status disappear before users could see it.
		if (completionTimer) return;
		clearDisplay();
	});

	pi.on("session_shutdown", async (event: any) => {
		turnActive = false;
		clearDisplay();
		activeCtx = null;
		if (event?.reason !== "reload" && event?.reason !== "quit") return;
		locallyCurrent = false;
		testedPiPatchBroker.markRetiring(shimmerOwner);
		const release = () => {
			testedPiPatchBroker.releaseSurface(shimmerOwner, SHIMMER_SURFACE);
			testedPiPatchBroker.releaseSurface(shimmerOwner, LOADER_PATCH_SURFACE);
		};
		if (event?.reason === "reload") deferGenerationRelease(release);
		else release();
	});
}
