import { CLAUDE_PALETTE } from "../claude-palette.ts";
import { resolveSurfaceColorSource } from "../presentation-profile.ts";
import { readSettings } from "../settings.ts";
import {
	ansiFromHex,
	getThemeFg,
	setThemeFg,
	storedHexColor,
	themeAccentIdentity,
	themeFgKeys,
	themePolarity,
} from "./theme-access.ts";

// Claude Code's selection/accent lavender, replacing pi's teal `accent`.
// Extraction + dark/light assignment: docs/plans/2026-07-16-cc-accent-color.md.
// pi's Theme stores READY-MADE ANSI ESCAPES in fgColors — theme.fg() only
// concatenates — so the override must store escapes, never hex (a hex string
// renders as literal text and widens lines past the terminal, crashing pi's
// renderer; shipped broken in 2.3.0). The 256-color indices are precomputed
// with pi's own rgbTo256 quantizer (147 matches the live CC capture).
const CC_ACCENT_ANSI = CLAUDE_PALETTE.accent;
// Every accent escape claudify has imposed on a theme. pi hands us the theme as
// both the instance and a forwarding Proxy, so a second object identity arrives
// with our override already installed; the snapshot guard must recognize it as
// ours, or it memorizes the override as the theme's own accent and accentColor=
// "theme" restores the override forever. A fixed CC list only covered the two
// captured lavenders — a custom hex stranded itself that way.
const appliedAccentValues = new Set<string>([
	CC_ACCENT_ANSI.dark.truecolor,
	CC_ACCENT_ANSI.dark.ansi256,
	CC_ACCENT_ANSI.light.truecolor,
	CC_ACCENT_ANSI.light.ansi256,
]);

interface AccentSnapshot {
	readonly original: string;
	/** fgColors keys (beyond "accent") whose value aliased the accent var at load —
	 * mdCode/mdListBullet in pi's dark theme. The theme says these surfaces are
	 * accent-colored, so the override carries them. */
	readonly aliasKeys: readonly string[];
}

const originalThemeAccent = new WeakMap<object, AccentSnapshot>();

/** pi hands the same logical theme to us as both the instance and a forwarding
 * Proxy — two object identities sharing one fgColors container. Keying the
 * snapshot on the theme object gave each identity its own entry, so whichever
 * arrived second saw the override already installed and never recorded the
 * theme's real accent; accentColor="theme" then had nothing to restore. The
 * container forwards through the Proxy, so it identifies the logical theme. */
export function applyAccentOverride(theme: unknown): void {
	if (!theme || typeof theme !== "object") return;
	const current = getThemeFg(theme, "accent");
	if (current === undefined) return;
	// Snapshot per logical theme (its fgColors container), not per object identity,
	// so the instance and its forwarding Proxy share one record. Never memorize an
	// already-overridden value as the theme's own accent.
	const identity = themeAccentIdentity(theme) ?? theme;
	if (!originalThemeAccent.has(identity) && !appliedAccentValues.has(current)) {
		const aliasKeys = themeFgKeys(theme)
			.filter((key) => key !== "accent" && getThemeFg(theme, key) === current);
		originalThemeAccent.set(identity, { original: current, aliasKeys });
	}
	const snapshot = originalThemeAccent.get(identity);
	const settings = readSettings().values;
	const accentColor = resolveSurfaceColorSource(settings, "accentColor");
	const customAccent = storedHexColor(accentColor);
	const colorMode = (theme as any).mode === "256color" ? "ansi256" : "truecolor";
	const polarity = themePolarity(theme);
	// Unknown/default foregrounds are not evidence of a dark terminal. Preserve
	// the theme's semantic accent unless polarity is known or a custom hex wins.
	const themeOwnsAccent = accentColor === "theme" || (!customAccent && polarity === "unknown");
	const target = themeOwnsAccent
		? snapshot?.original ?? current
		: customAccent
			? ansiFromHex(theme, customAccent, "foreground")
				?? CC_ACCENT_ANSI[polarity === "light" ? "light" : "dark"][colorMode]
			: CC_ACCENT_ANSI[polarity === "light" ? "light" : "dark"][colorMode];
	// Register only values we impose, never a restored original: a theme whose own
	// accent happens to equal some other theme's custom color must still snapshot.
	if (!themeOwnsAccent) appliedAccentValues.add(target);
	if (current !== target) setThemeFg(theme, "accent", target);
	for (const key of snapshot?.aliasKeys ?? []) {
		if (getThemeFg(theme, key) !== target) setThemeFg(theme, key, target);
	}
}
