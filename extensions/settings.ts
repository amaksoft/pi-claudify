import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { MessageSpacing, MessageStyle, WorkedVerbMode } from "./message-chrome.ts";

export type SettingsSource = "user" | "project";
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

export interface SettingsFileInfo {
	path: string;
	status: SettingsFileStatus;
}

export interface SettingsSnapshot {
	values: SettingsFile;
	sources: Record<string, SettingsSource>;
	/**
	 * Read status per settings file. An "invalid" file contributes no values,
	 * which is indistinguishable from "missing" in `values`/`sources` alone —
	 * consumers that surface provenance must check this to avoid claiming a
	 * clean merge over a file that actually failed to parse.
	 */
	files: Record<SettingsSource, SettingsFileInfo>;
}

interface CachedSettings extends SettingsSnapshot {
	cacheKey: string;
	timestamp: number;
}

const SETTINGS_CACHE_TTL_MS = 1_000;
let settingsCache: CachedSettings | null = null;

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
	return normalized as SettingsFile;
}

function cloneSnapshot(snapshot: SettingsSnapshot): SettingsSnapshot {
	return {
		values: structuredClone(snapshot.values),
		sources: { ...snapshot.sources },
		files: {
			user: { ...snapshot.files.user },
			project: { ...snapshot.files.project },
		},
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
	const files: Record<SettingsSource, SettingsFileInfo> = {
		user: { path: userPath, status: "missing" },
		project: { path: projectPath, status: "missing" },
	};
	for (const [source, path] of [["user", userPath], ["project", projectPath]] as const) {
		const { data, status } = readSettingsFile(path);
		files[source] = { path, status };
		const settings = normalizeAliases(data);
		for (const [key, value] of Object.entries(settings)) {
			values[key] = value;
			sources[key] = source;
		}
	}

	settingsCache = { values, sources, files, cacheKey, timestamp: now };
	return cloneSnapshot(settingsCache);
}
