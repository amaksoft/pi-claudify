import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { MessageSpacing, MessageStyle, WorkedVerbMode } from "./message-chrome.ts";

export type SettingsSource = "user" | "project";
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
	bashStackConsecutive?: boolean;
	bashSemanticDisplay?: boolean;
	readOnlyToolGrouping?: boolean;
	readOnlyToolGroupLimit?: number;
	showTruncationHints?: boolean;
	diffCollapsedLines?: number;
	diffTheme?: string;
	diffColors?: Record<string, string>;
	diffPalette?: "claude" | "theme";
	toolChrome?: "claude" | "theme";
	themeAdaptive?: boolean;
	spinnerColor?: string;
	spinnerStatusColor?: string;
	spinnerVerbs?: string[];
	spinnerVerbMode?: SpinnerVerbMode;
	messageStyle?: MessageStyle;
	assistantPrefix?: string;
	thinkingPrefix?: string;
	messageSpacing?: MessageSpacing;
	hiddenThinkingLabel?: string;
	workedVerbs?: string[];
	workedVerbMode?: WorkedVerbMode;
}

export interface SettingsSnapshot {
	values: SettingsFile;
	sources: Record<string, SettingsSource>;
}

interface CachedSettings extends SettingsSnapshot {
	cacheKey: string;
	timestamp: number;
}

const SETTINGS_CACHE_TTL_MS = 5_000;
let settingsCache: CachedSettings | null = null;

function readSettingsFile(path: string): Record<string, unknown> {
	try {
		if (!path || !existsSync(path)) return {};
		const raw = JSON.parse(readFileSync(path, "utf8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
		return raw as Record<string, unknown>;
	} catch {
		return {};
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
	return normalized as SettingsFile;
}

function cloneSnapshot(snapshot: SettingsSnapshot): SettingsSnapshot {
	return {
		values: structuredClone(snapshot.values),
		sources: { ...snapshot.sources },
	};
}

export function clearSettingsCache(): void {
	settingsCache = null;
}

export function readSettings(): SettingsSnapshot {
	const home = process.env.HOME ?? "";
	const userPath = home ? join(home, ".pi", "settings.json") : "";
	const projectPath = join(process.cwd(), ".pi", "settings.json");
	const cacheKey = `${userPath}\0${projectPath}`;
	const now = Date.now();
	if (settingsCache
		&& settingsCache.cacheKey === cacheKey
		&& now - settingsCache.timestamp < SETTINGS_CACHE_TTL_MS) {
		return cloneSnapshot(settingsCache);
	}

	const values: SettingsFile = {};
	const sources: Record<string, SettingsSource> = {};
	for (const [source, path] of [["user", userPath], ["project", projectPath]] as const) {
		const settings = normalizeAliases(readSettingsFile(path));
		for (const [key, value] of Object.entries(settings)) {
			values[key] = value;
			sources[key] = source;
		}
	}

	settingsCache = { values, sources, cacheKey, timestamp: now };
	return cloneSnapshot(settingsCache);
}
