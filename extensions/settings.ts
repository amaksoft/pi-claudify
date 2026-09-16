import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { MessageSpacing, MessageStyle, WorkedVerbMode } from "./message-chrome.ts";
import type { CompatibilityConfig } from "./domain/compatibility.ts";

export const DEFAULT_EXPANDED_PREVIEW_MAX_LINES = 4_000;

export type SettingsFileStatus = "ok" | "missing" | "invalid";
export type SpinnerVerbMode = "append" | "replace";

export interface SettingsFile {
	[key: string]: unknown;
	toolBackground?: "default" | "transparent" | "outlines";
	readOutputMode?: "hidden" | "summary" | "preview";
	searchOutputMode?: "hidden" | "count" | "preview";
	mcpOutputMode?: "hidden" | "summary" | "preview";
	previewLines?: number;
	expandedPreviewMaxLines?: number;
	bashOutputMode?: "opencode" | "summary" | "preview";
	bashCollapsedLines?: number;
	bashRunningPreview?: "head" | "tail";
	bashStackConsecutive?: boolean;
	bashSemanticDisplay?: boolean;
	readOnlyToolGrouping?: boolean;
	groupShellCommands?: boolean;
	readOnlyToolGroupLimit?: number;
	/**
	 * Legacy exact-name tool skip list, kept for backward compatibility. A name
	 * here behaves like `compatibility.tools[name] = false` unless a more
	 * specific `compatibility.tools[name]` entry overrides it — see
	 * extensions/domain/compatibility.ts.
	 */
	skipToolOverrides?: string[];
	showTruncationHints?: boolean;
	diffCollapsedLines?: number;
	diffSyntaxHighlighting?: boolean;
	diffTheme?: string;
	diffColors?: Record<string, string>;
	colorSource?: "claude" | "theme";
	markdownStyle?: "claude" | "pi";
	diffPalette?: "claude" | "theme";
	toolChrome?: "claude" | "theme";
	themeAdaptive?: boolean;
	spinnerColor?: string;
	spinnerStatusColor?: string;
	spinnerPlacement?: "above" | "input";
	spinnerShimmer?: boolean;
	spinnerVerbs?: string[];
	spinnerVerbMode?: SpinnerVerbMode;
	messageStyle?: MessageStyle;
	assistantPrefix?: string;
	thinkingPrefix?: string;
	messageSpacing?: MessageSpacing;
	hiddenThinkingLabel?: string;
	workedVerbs?: string[];
	workedVerbMode?: WorkedVerbMode;
	footerStyle?: "claude" | "pi";
	footerColorMode?: "colored" | "single" | "monochrome";
	footerColor?: string;
	footerUsageBar?: boolean;
	footerEffort?: boolean;
	footerCost?: boolean;
	footerSessionStats?: boolean;
	editorBorder?: "gray" | "thinking";
	accentColor?: "claude" | "theme" | `#${string}`;
	userMessageBox?: "theme" | "claude" | "off" | `#${string}`;
	bannerMode?: "off" | "onboarding" | "always";
	bannerFrame?: boolean;
	promptPointer?: boolean;
}

export interface SettingsFileInfo {
	path: string;
	status: SettingsFileStatus;
}

export interface SettingsSnapshot {
	values: SettingsFile;
	file: SettingsFileInfo;
}

export interface SettingsWriteResult {
	readonly success: boolean;
	readonly backupCreated: boolean;
}

interface CachedSettings extends SettingsSnapshot {
	cacheKey: string;
	timestamp: number;
}

const SETTINGS_CACHE_TTL_MS = 1_000;
let settingsCache: CachedSettings | null = null;
let settingsFingerprint: string | null = null;
let settingsRevision = 0;

function readSettingsFile(path: string): { data: Record<string, unknown>; status: SettingsFileStatus } {
	if (!path || !existsSync(path)) return { data: {}, status: "missing" };
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { data: {}, status: "invalid" };
		return { data: raw as Record<string, unknown>, status: "ok" };
	} catch {
		return { data: {}, status: "invalid" };
	}
}

function normalizeAliases(settings: Record<string, unknown>): SettingsFile {
	const normalized = structuredClone(settings);
	if (!Object.prototype.hasOwnProperty.call(normalized, "spinnerColor")
		&& Object.prototype.hasOwnProperty.call(normalized, "spinnerVerbColor")) {
		normalized.spinnerColor = normalized.spinnerVerbColor;
	}
	delete normalized.spinnerVerbColor;
	if (normalized.toolBackground === "border") normalized.toolBackground = "outlines";
	if (!Object.prototype.hasOwnProperty.call(normalized, "skipToolOverrides")
		&& Array.isArray(normalized.ccSkipToolOverrides)) {
		normalized.skipToolOverrides = normalized.ccSkipToolOverrides;
	}
	delete normalized.ccSkipToolOverrides;
	if (!Object.prototype.hasOwnProperty.call(normalized, "bannerMode")
		&& (normalized.ccBannerMode === "off" || normalized.ccBannerMode === "onboarding" || normalized.ccBannerMode === "always")) {
		normalized.bannerMode = normalized.ccBannerMode;
	}
	delete normalized.ccBannerMode;
	delete normalized.ccBrandMark;
	if (!Object.prototype.hasOwnProperty.call(normalized, "footerUsageBar")
		&& Object.prototype.hasOwnProperty.call(normalized, "footerContextBar")) {
		normalized.footerUsageBar = normalized.footerContextBar;
	}
	delete normalized.footerContextBar;
	return normalized as SettingsFile;
}

function cloneSnapshot(snapshot: SettingsSnapshot): SettingsSnapshot {
	return {
		values: structuredClone(snapshot.values),
		file: { ...snapshot.file },
	};
}

export function clearSettingsCache(): void {
	settingsCache = null;
	settingsRevision++;
}

/**
 * Monotonic version for render caches that consume settings. Calling this also
 * refreshes an expired file snapshot, so edits made outside the Hub eventually
 * invalidate mounted rows too.
 */
export function getSettingsRevision(): number {
	readSettings();
	return settingsRevision;
}

export function writeSettingsKey(key: string, value: unknown): SettingsWriteResult {
	clearSettingsCache();
	const home = process.env.HOME ?? "";
	if (!home) return { success: false, backupCreated: false };
	const dir = join(home, ".pi");
	const path = join(dir, "settings.json");
	let settings: Record<string, unknown> = {};
	let invalid = false;
	try {
		if (existsSync(path)) {
			const raw = JSON.parse(readFileSync(path, "utf8"));
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid = true;
			else settings = raw as Record<string, unknown>;
		}
	} catch {
		invalid = true;
	}
	let backupCreated = false;
	if (invalid) {
		// Refuse to replace the user's whole settings file unless the broken
		// original remains recoverable.
		try {
			copyFileSync(path, `${path}.bak`);
			backupCreated = true;
		} catch {
			return { success: false, backupCreated: false };
		}
	}
	settings = normalizeAliases(settings);
	if (value === undefined) {
		delete settings[key];
	} else {
		settings[key] = value;
	}
	try {
		mkdirSync(dir, { recursive: true });
		// Write atomically: a failed/interrupted write must never truncate the
		// existing (healthy) settings file. Immediate-commit editing calls this
		// on every keystroke, so a torn write is a real exposure.
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
		renameSync(tmp, path);
		return { success: true, backupCreated };
	} catch {
		return { success: false, backupCreated };
	}
}

export function readSettings(): SettingsSnapshot {
	const home = process.env.HOME ?? "";
	const userPath = home ? join(home, ".pi", "settings.json") : "";
	const now = Date.now();
	if (settingsCache
		&& settingsCache.cacheKey === userPath
		&& now - settingsCache.timestamp < SETTINGS_CACHE_TTL_MS) {
		return cloneSnapshot(settingsCache);
	}

	const { data, status } = readSettingsFile(userPath);
	const values = normalizeAliases(data);
	const fingerprint = `${userPath}\u0000${status}\u0000${JSON.stringify(values)}`;
	if (fingerprint !== settingsFingerprint) {
		settingsFingerprint = fingerprint;
		settingsRevision++;
	}
	settingsCache = {
		values,
		file: { path: userPath, status },
		cacheKey: userPath,
		timestamp: now,
	};
	return cloneSnapshot(settingsCache);
}
