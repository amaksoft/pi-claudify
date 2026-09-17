// Compatibility control — the backward-compatible `compatibility` config that
// lets a host or user disable individual Claudify surfaces (or all of them)
// without uninstalling the package. Absent config means current behavior:
// every feature and tool stays enabled exactly as before this module existed.
//
// Pure types/constants/parsing/resolution only. This module must not import
// Pi host packages, extensions/host/*, or perform host I/O (enforced by
// scripts/test-architecture-boundaries.ts) so the precedence rules are
// unit-testable without a live pi session or a real settings file.
//
// See README.md "Compatibility control" for the user-facing contract and
// config/config.example.json for a worked example.

/**
 * The complete, fixed set of gate-able Claudify surfaces. Callers should treat
 * this array (not a hand-copied literal) as the source of truth — tests assert
 * every id here has a real wiring point and that no other id sneaks in.
 */
export const COMPATIBILITY_FEATURE_IDS = [
	"settingsCommand",
	"fullscreenTui",
	"themeColors",
	"assistantMessages",
	"userMessages",
	"customMessages",
	"compactionSummary",
	"toolPresentation",
	"toolBackground",
	"diffPresentation",
	"inspectionGroups",
	"bashStacking",
	"mouseInteraction",
	"spinner",
	"footer",
	"banner",
	"promptPointer",
	"scheduledTasks",
	"askUserQuestion",
] as const;

export type CompatibilityFeatureId = (typeof COMPATIBILITY_FEATURE_IDS)[number];

const COMPATIBILITY_FEATURE_ID_SET: ReadonlySet<string> = new Set(COMPATIBILITY_FEATURE_IDS);

export function isCompatibilityFeatureId(value: unknown): value is CompatibilityFeatureId {
	return typeof value === "string" && COMPATIBILITY_FEATURE_ID_SET.has(value);
}

/**
 * The eight builtin tool identities `compatibility.tools` can name exactly:
 * the seven presenter overrides (read/write/edit/bash/grep/find/ls) plus
 * apply_patch, whose presentation-only override is not routed through the
 * same registration coordinator but is gated identically.
 */
export const BUILTIN_COMPATIBILITY_TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls", "apply_patch"] as const;
export type BuiltinCompatibilityToolName = (typeof BUILTIN_COMPATIBILITY_TOOL_NAMES)[number];

export const CRON_COMPATIBILITY_TOOL_NAMES = ["croncreate", "cronlist", "crondelete"] as const;
export const ASK_USER_QUESTION_TOOL_NAME = "askuserquestion" as const;
export const CLAUDIFY_REGISTERED_TOOL_NAMES = [...BUILTIN_COMPATIBILITY_TOOL_NAMES, ...CRON_COMPATIBILITY_TOOL_NAMES, ASK_USER_QUESTION_TOOL_NAME] as const;

const BUILTIN_COMPATIBILITY_TOOL_NAME_SET: ReadonlySet<string> = new Set(BUILTIN_COMPATIBILITY_TOOL_NAMES);

export function isBuiltinCompatibilityToolName(value: unknown): value is BuiltinCompatibilityToolName {
	return typeof value === "string" && BUILTIN_COMPATIBILITY_TOOL_NAME_SET.has(value);
}

/** Dynamic (non-builtin) tool families addressable via `mcp:*` / `openai:*` / `generic:*`. */
export type CompatibilityToolFamily = "mcp" | "openai" | "generic";
export const COMPATIBILITY_TOOL_FAMILIES: readonly CompatibilityToolFamily[] = ["mcp", "openai", "generic"];

export function compatibilityToolFamilyKey(family: CompatibilityToolFamily): string {
	return `${family}:*`;
}

/** Catch-all key consulted after exact name and family, before the `true` default. */
export const COMPATIBILITY_TOOL_DEFAULT_KEY = "default";

export type CompatibilityFeatureMap = Partial<Record<CompatibilityFeatureId, boolean>>;
export type CompatibilityToolMap = Record<string, boolean>;

export interface CompatibilityConfig {
	/** Global switch. `false` disables every feature and every tool, including `/claudify` and the spinner. */
	enabled?: boolean;
	features?: CompatibilityFeatureMap;
	tools?: CompatibilityToolMap;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseFeatureMap(raw: unknown): CompatibilityFeatureMap | undefined {
	if (!isPlainObject(raw)) return undefined;
	const result: CompatibilityFeatureMap = {};
	let any = false;
	for (const [key, value] of Object.entries(raw)) {
		if (!isCompatibilityFeatureId(key) || typeof value !== "boolean") continue;
		result[key] = value;
		any = true;
	}
	return any ? result : undefined;
}

function parseToolMap(raw: unknown): CompatibilityToolMap | undefined {
	if (!isPlainObject(raw)) return undefined;
	const result: CompatibilityToolMap = {};
	let any = false;
	for (const [key, value] of Object.entries(raw)) {
		if (typeof key !== "string" || key.length === 0 || typeof value !== "boolean") continue;
		result[key.toLowerCase()] = value;
		any = true;
	}
	return any ? result : undefined;
}

/**
 * Parses the raw `compatibility` settings value into a normalized config.
 * Malformed or unrecognized pieces are dropped rather than thrown — a bad
 * hand-edit of `~/.pi/settings.json` degrades to current (fully-enabled)
 * behavior instead of crashing the extension. Returns `undefined` when there
 * is nothing usable, so callers can cheaply special-case "absent config".
 */
export function parseCompatibilityConfig(raw: unknown): CompatibilityConfig | undefined {
	if (!isPlainObject(raw)) return undefined;
	const config: CompatibilityConfig = {};
	if (typeof raw.enabled === "boolean") config.enabled = raw.enabled;
	const features = parseFeatureMap(raw.features);
	if (features) config.features = features;
	const tools = parseToolMap(raw.tools);
	if (tools) config.tools = tools;
	return config.enabled === undefined && !config.features && !config.tools ? undefined : config;
}

/**
 * Global `enabled: false` disables every feature — even one with an explicit
 * `features[id] = true` — because the global switch always wins. Absent
 * config, an absent global switch, and an absent per-feature entry all mean
 * "enabled" (current, pre-compatibility-control behavior).
 */
export function resolveCompatibilityFeatureEnabled(
	config: CompatibilityConfig | undefined,
	featureId: CompatibilityFeatureId,
): boolean {
	if (config?.enabled === false) return false;
	return config?.features?.[featureId] !== false;
}

/**
 * Tool resolution order: global `enabled`, then an exact tool-name entry in
 * `tools`, then the legacy `skipToolOverrides` exact-false override (kept for
 * backward compatibility — behaves like `tools[name] = false` unless a more
 * specific `tools[name]` entry overrides it), then the tool's family key
 * (`mcp:*` / `openai:*` / `generic:*`), then `tools.default`, then `true`.
 */
export function resolveCompatibilityToolEnabled(
	config: CompatibilityConfig | undefined,
	toolName: string,
	family?: CompatibilityToolFamily,
	legacySkipped = false,
): boolean {
	if (config?.enabled === false) return false;
	const tools = config?.tools;
	const exact = tools?.[toolName.toLowerCase()];
	if (typeof exact === "boolean") return exact;
	if (legacySkipped) return false;
	if (family) {
		const familyValue = tools?.[compatibilityToolFamilyKey(family)];
		if (typeof familyValue === "boolean") return familyValue;
	}
	const fallback = tools?.[COMPATIBILITY_TOOL_DEFAULT_KEY];
	if (typeof fallback === "boolean") return fallback;
	return true;
}

// ---------------------------------------------------------------------------
// Settings-shaped convenience wrappers. These accept the raw settings-values
// record (rather than importing SettingsFile, which would pull settings.ts's
// node:fs dependency into this pure module) so host modules can gate a
// feature or tool in one call without re-parsing `compatibility` themselves.
// ---------------------------------------------------------------------------

export function compatibilityConfigFromSettings(values: Record<string, unknown> | undefined | null): CompatibilityConfig | undefined {
	return parseCompatibilityConfig(values?.compatibility);
}

export function settingsFeatureEnabled(
	values: Record<string, unknown> | undefined | null,
	featureId: CompatibilityFeatureId,
): boolean {
	return resolveCompatibilityFeatureEnabled(compatibilityConfigFromSettings(values), featureId);
}

export function settingsToolEnabled(
	values: Record<string, unknown> | undefined | null,
	toolName: string,
	family?: CompatibilityToolFamily,
	legacySkipped = false,
): boolean {
	return resolveCompatibilityToolEnabled(compatibilityConfigFromSettings(values), toolName, family, legacySkipped);
}
