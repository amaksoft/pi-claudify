import { visibleWidth } from "@earendil-works/pi-tui";

import { DEFAULT_USER_PREFIX, formatTranscriptLines } from "../message-chrome.ts";
import { patchMethodOnce } from "./patch-once.ts";
import { sharedState } from "./shared-state.ts";

const USER_PREFIX_WIDTH = visibleWidth(`${DEFAULT_USER_PREFIX} `);

export type UserMessageBoxMode = "theme" | "claude" | "off" | `#${string}`;

export interface UserMessagePatchRuntime {
	transparentBg: () => string;
	transparentReset: () => string;
	defaultForeground: () => string;
	workedLineForeground: () => string;
	claudeBoxBackground: () => string;
	claudeBoxTextForeground: () => string;
	claudeBoxPrefixForeground: () => string;
	themeBoxBackground: () => string | null;
	themeBoxPrefixForeground: () => string | null;
	customBoxBackground: (mode: string) => string | null;
	boxMode(): UserMessageBoxMode;
	/**
	 * `userMessages: false` pass-through, checked live on every render (not
	 * just at patch-install time) because the prototype patch below installs
	 * at most once per process and a later generation must still be able to
	 * revert to pi's native rendering without a stale wrapper.
	 */
	enabled(): boolean;
}

const STATE_KEY = Symbol.for("pi-claudify:user-message-patch-state");
interface UserPatchState { runtime?: UserMessagePatchRuntime }
function state(): UserPatchState { return sharedState(STATE_KEY, () => ({})); }

function stripOsc133Zones(line: string): string {
	return line.replace("\x1b]133;A\x07", "").replace("\x1b]133;B\x07", "").replace("\x1b]133;C\x07", "");
}
function stripBackgroundAnsi(text: string): string {
	return text.replace(/\x1b\[([0-9;]*)m/g, (match, paramsText: string) => {
		const params = paramsText === "" ? ["0"] : paramsText.split(";");
		const kept: string[] = [];
		for (let index = 0; index < params.length; index++) {
			const code = Number(params[index] || "0");
			if (code === 48) { const mode = Number(params[index + 1] || "0"); index += mode === 2 ? 4 : mode === 5 ? 2 : 0; continue; }
			if (code === 49 || (code >= 40 && code <= 47) || (code >= 100 && code <= 107)) continue;
			kept.push(params[index]);
		}
		return kept.length === 0 ? "" : `\x1b[${kept.join(";")}m`;
	});
}
function trimAnsiRight(text: string): string {
	let result = text;
	while (true) {
		const next = result.replace(/[ \t]+((?:\x1b\[[0-9;]*m)*)$/g, "$1");
		if (next === result) return result;
		result = next;
	}
}
function stripAnsi(text: string): string { return text.replace(/\x1b\[[0-9;]*m/g, ""); }
function cleanLine(runtime: UserMessagePatchRuntime, line: string): string {
	return `${runtime.transparentBg()}${trimAnsiRight(stripBackgroundAnsi(stripOsc133Zones(line)))}${runtime.transparentBg()}`;
}
function cleanBoxedLine(line: string): string { return trimAnsiRight(stripBackgroundAnsi(stripOsc133Zones(line))); }

export function applyUserMessageBox(
	runtime: UserMessagePatchRuntime,
	lines: string[],
	mode: Exclude<UserMessageBoxMode, "off">,
	maxWidth: number,
): string[] {
	const background = mode === "theme"
		? runtime.themeBoxBackground() ?? runtime.claudeBoxBackground()
		: mode === "claude"
			? runtime.claudeBoxBackground()
			: runtime.customBoxBackground(mode) ?? runtime.claudeBoxBackground();
	const prefixForeground = (mode === "theme" ? runtime.themeBoxPrefixForeground() : null) ?? runtime.claudeBoxPrefixForeground();
	const textForeground = mode === "claude" ? runtime.claudeBoxTextForeground() : "";
	const contentIndexes = lines.flatMap((line, index) => stripAnsi(line).trim() ? [index] : []);
	if (contentIndexes.length === 0) return lines;
	const first = contentIndexes[0];
	const last = contentIndexes.at(-1)!;
	const boxWidth = Math.min(Math.max(1, maxWidth), Math.max(...contentIndexes.map((index) => visibleWidth(lines[index]))) + 1);
	return lines.map((line, index) => {
		if (index < first || index > last) return line;
		let body = line;
		if (index === first && body.startsWith(DEFAULT_USER_PREFIX)) body = `${prefixForeground}${DEFAULT_USER_PREFIX}${runtime.defaultForeground()}${textForeground}${body.slice(DEFAULT_USER_PREFIX.length)}`;
		else if (textForeground && stripAnsi(body).trim()) body = `${textForeground}${body}`;
		return `${background}${body}${" ".repeat(Math.max(0, boxWidth - visibleWidth(line)))}${runtime.transparentBg()}${runtime.defaultForeground()}`;
	});
}

export function patchUserMessageRenderer(ComponentClass: any, flag: symbol, runtime: UserMessagePatchRuntime): void {
	state().runtime = runtime;
	patchMethodOnce(ComponentClass?.prototype, flag, "render", (originalRender) =>
		function patchedUserMessageRender(this: any, width: number) {
		const active = state().runtime ?? runtime;
		if (!active.enabled()) return originalRender.call(this, width);
		for (const child of this.children ?? []) {
			if (!child || typeof child.render !== "function") continue;
			let dirty = false;
			if (child.defaultTextStyle?.bgColor) { child.defaultTextStyle.bgColor = undefined; dirty = true; }
			if (typeof child.paddingX === "number" && child.paddingX !== 0) { child.paddingX = 0; dirty = true; }
			if (dirty) child.invalidate?.();
		}
		const lines = originalRender.call(this, Math.max(1, width - USER_PREFIX_WIDTH));
		if (!Array.isArray(lines) || lines.length === 0) return lines;
		const mode = active.boxMode();
		const cleaner = mode === "off" ? (line: string) => cleanLine(active, line) : cleanBoxedLine;
		const formatted = formatTranscriptLines(lines.map(cleaner), { prefix: DEFAULT_USER_PREFIX, spacing: "comfortable", normalizeChecks: false, visibleWidth });
		const rendered = mode === "off"
			? formatted.map((line, index) => index === 0 && line.startsWith(DEFAULT_USER_PREFIX)
				? `${active.workedLineForeground()}${DEFAULT_USER_PREFIX}${active.transparentReset()}${line.slice(DEFAULT_USER_PREFIX.length)}`
				: line)
			: applyUserMessageBox(active, formatted, mode, width);
		rendered[0] = `\x1b]133;A\x07${rendered[0]}`;
		rendered[rendered.length - 1] += "\x1b]133;B\x07\x1b]133;C\x07";
		return rendered;
		},
	);
}
