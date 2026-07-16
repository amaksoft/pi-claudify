import { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { readSettings, type SettingsFile } from "./settings.ts";

// Claude Code-style statusline footer + pinned-gray input border.
// Capture and decisions: docs/plans/2026-07-16-cc-input-box-footer.md.
// The line grammar and every SGR sequence mirror ~/.claude/statusline-command.sh
// byte-for-byte; the segments it can't feed from pi (Usage/Reset — Claude
// subscription rate limits) are deliberately omitted, and Effort is appended
// from pi's thinking level.

export type FooterStyle = "claude" | "pi";
export type FooterColorMode = "colored" | "single" | "monochrome";
export type EditorBorderMode = "gray" | "thinking";

export interface FooterSettings {
	readonly style: FooterStyle;
	readonly colorMode: FooterColorMode;
	readonly color: string;
	readonly contextBar: boolean;
	readonly editorBorder: EditorBorderMode;
}

export const DEFAULT_FOOTER_COLOR = "#FF9200";

const RESET = "\x1b[0m";
const BLUE = "\x1b[0;34m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[0;33m";
const CYAN = "\x1b[0;36m";
const GRAY = "\x1b[0;90m";
const MAGENTA = "\x1b[0;35m";
// The statusline script's LEVEL_9 tier — dark red for a context window >75% full.
const CONTEXT_HOT = "\x1b[38;5;160m";
// Claude Code's input-box gray under a 256-color terminal; used only when the
// active theme has no borderMuted key to fall back on.
const FALLBACK_BORDER_GRAY = "\x1b[38;5;244m";

const BAR_BLOCKS = 10;

/** Accepts "#RRGGBB" or "RRGGBB" (any case); returns canonical "#RRGGBB" or null. */
export function normalizeHexColor(raw: string): string | null {
	const match = /^#?([0-9a-fA-F]{6})$/.exec(raw.trim());
	return match ? `#${match[1].toUpperCase()}` : null;
}

function hexToAnsi(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}

export function resolveFooterSettings(values: SettingsFile): FooterSettings {
	const style = values.footerStyle === "pi" ? "pi" : "claude";
	const colorMode = values.footerColorMode === "single" || values.footerColorMode === "monochrome"
		? values.footerColorMode
		: "colored";
	const color = typeof values.footerColor === "string"
		? normalizeHexColor(values.footerColor) ?? DEFAULT_FOOTER_COLOR
		: DEFAULT_FOOTER_COLOR;
	return {
		style,
		colorMode,
		color,
		contextBar: values.footerContextBar !== false,
		editorBorder: values.editorBorder === "thinking" ? "thinking" : "gray",
	};
}

export interface FooterLineData {
	readonly directory: string;
	/** null outside a git repo — the segment is omitted, like the script. */
	readonly branch: string | null;
	readonly modelName: string | null;
	/** Percent of the current model's context window; null while tokens are unknown. */
	readonly contextPercent: number | null;
	/** pi thinking level; null when the model has no reasoning support. */
	readonly effort: string | null;
}

interface SegmentPalette {
	readonly dir: string;
	readonly branch: string;
	readonly model: string;
	readonly contextCool: string;
	readonly contextWarm: string;
	readonly contextHot: string;
	readonly effort: string;
	readonly separator: string;
	readonly reset: string;
}

function paletteFor(settings: FooterSettings): SegmentPalette {
	if (settings.colorMode === "monochrome") {
		return { dir: "", branch: "", model: "", contextCool: "", contextWarm: "", contextHot: "", effort: "", separator: "", reset: "" };
	}
	if (settings.colorMode === "single") {
		const single = hexToAnsi(settings.color);
		return {
			dir: single,
			branch: single,
			model: single,
			contextCool: single,
			contextWarm: single,
			contextHot: single,
			effort: single,
			separator: single,
			reset: RESET,
		};
	}
	return {
		dir: BLUE,
		branch: GREEN,
		model: YELLOW,
		contextCool: CYAN,
		contextWarm: YELLOW,
		contextHot: CONTEXT_HOT,
		effort: MAGENTA,
		separator: GRAY,
		reset: RESET,
	};
}

function contextBar(percent: number | null): string {
	const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
	// The script's integer rounding: (utilization * 10 + 50) / 100, pinned at the ends.
	const filled = clamped === 0 ? 0 : clamped === 100 ? BAR_BLOCKS : Math.floor((clamped * BAR_BLOCKS + 50) / 100);
	return ` ${"▓".repeat(filled)}${"░".repeat(BAR_BLOCKS - filled)}`;
}

export function buildFooterLine(data: FooterLineData, settings: FooterSettings): string {
	const palette = paletteFor(settings);
	const paint = (color: string, text: string): string => (color ? `${color}${text}${palette.reset}` : text);
	const segments: string[] = [];

	if (data.directory) segments.push(paint(palette.dir, data.directory));
	if (data.branch) segments.push(paint(palette.branch, `⎇ ${data.branch}`));
	if (data.modelName) segments.push(paint(palette.model, data.modelName));

	const percent = data.contextPercent === null ? null : Math.floor(Math.max(0, Math.min(100, data.contextPercent)));
	const contextColor = percent !== null && percent > 75
		? palette.contextHot
		: percent !== null && percent > 50
			? palette.contextWarm
			: palette.contextCool;
	const bar = settings.contextBar ? contextBar(percent) : "";
	segments.push(paint(contextColor, `Ctx: ${percent === null ? "?" : `${percent}%`}${bar}`));

	if (data.effort) segments.push(paint(palette.effort, `Effort: ${data.effort}`));

	const separator = paint(palette.separator, " │ ");
	// Claude Code renders the statusline indented two columns below the input box.
	return `  ${segments.join(separator)}`;
}

/** The slice of pi's FooterDataProvider the footer reads; structural so tests can fake it. */
export interface FooterDataLike {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
}

/** Live session probes, each already guarded by the caller against a torn-down session. */
export interface FooterSources {
	getDirectory(): string;
	getBranch(footerData: FooterDataLike): string | null;
	getModelName(): string | null;
	getContextPercent(): number | null;
	getEffort(): string | null;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export class ClaudeFooterComponent {
	private readonly footerData: FooterDataLike;
	private readonly sources: FooterSources;

	constructor(footerData: FooterDataLike, sources: FooterSources) {
		this.footerData = footerData;
		this.sources = sources;
	}

	// pi-tui's Component contract declares invalidate() as required even though
	// every runtime call site optional-chains it; the no-op keeps the contract.
	invalidate(): void {}

	render(width: number): string[] {
		const settings = resolveFooterSettings(readSettings().values);
		const line = buildFooterLine(
			{
				directory: this.sources.getDirectory(),
				branch: this.sources.getBranch(this.footerData),
				modelName: this.sources.getModelName(),
				contextPercent: this.sources.getContextPercent(),
				effort: this.sources.getEffort(),
			},
			settings,
		);
		const lines = [truncateToWidth(line, width, "…")];
		// pi's stock footer surfaces other extensions' ctx.ui.setStatus lines;
		// replacing the footer must not eat them.
		const statuses = [...this.footerData.getExtensionStatuses().entries()]
			.sort(([a], [b]) => a.localeCompare(b));
		const dim = settings.colorMode === "monochrome" ? "" : GRAY;
		for (const [, text] of statuses) {
			const status = sanitizeStatusText(text);
			if (!status) continue;
			lines.push(truncateToWidth(dim ? `  ${dim}${status}${RESET}` : `  ${status}`, width, "…"));
		}
		return lines;
	}
}

/**
 * Install (or uninstall) the Claude-style footer for the current session.
 * Safe to call repeatedly — setFooter replaces the previous factory — and from
 * both session events and the /claudify commit handler, whose ctx objects both
 * expose ui/sessionManager/model/getContextUsage.
 */
export function installClaudeFooter(ctx: any, pi: any): void {
	if (!ctx?.hasUI || typeof ctx.ui?.setFooter !== "function") return;
	if (resolveFooterSettings(readSettings().values).style !== "claude") {
		ctx.ui.setFooter(undefined);
		return;
	}
	const sources: FooterSources = {
		getDirectory() {
			try {
				const cwd: unknown = ctx.sessionManager?.getCwd?.();
				const path = typeof cwd === "string" && cwd ? cwd : process.cwd();
				return path.split("/").filter(Boolean).pop() ?? path;
			} catch {
				return "";
			}
		},
		getBranch(footerData) {
			try {
				return footerData.getGitBranch();
			} catch {
				return null;
			}
		},
		getModelName() {
			try {
				return ctx.model?.name || ctx.model?.id || null;
			} catch {
				return null;
			}
		},
		getContextPercent() {
			try {
				const percent: unknown = ctx.getContextUsage?.()?.percent;
				return typeof percent === "number" && Number.isFinite(percent) ? percent : null;
			} catch {
				return null;
			}
		},
		getEffort() {
			try {
				if (!ctx.model?.reasoning) return null;
				const level: unknown = pi?.getThinkingLevel?.();
				return typeof level === "string" && level ? level : null;
			} catch {
				return null;
			}
		},
	};
	ctx.ui.setFooter((_tui: unknown, _theme: unknown, footerData: FooterDataLike) =>
		new ClaudeFooterComponent(footerData, sources));
}

const BORDER_PATCH_FLAG = Symbol.for("claudify.editorBorderPatch");

/**
 * Pin pi's input-box border to gray, the way Claude Code keeps it in every
 * permission mode and at every effort level. pi reassigns
 * editor.borderColor = theme.getThinkingBorderColor(level) on every thinking/
 * model/theme event, so patching the editor instance would not hold; wrapping
 * the Theme method does, and the returned colorizer re-checks the setting each
 * time it runs (every render), so toggling editorBorder reflects live without
 * waiting for a thinking-level event. Bash mode (getBashModeBorderColor) is
 * left untouched — Claude Code recolors that state too.
 */
export function patchEditorBorderColor(): void {
	const proto = Theme.prototype as any;
	if (proto[BORDER_PATCH_FLAG]) return;
	const original = proto.getThinkingBorderColor;
	if (typeof original !== "function") return;
	proto.getThinkingBorderColor = function patchedThinkingBorderColor(level: unknown): (str: string) => string {
		const passthrough = original.call(this, level);
		return (str: string): string => {
			if (resolveFooterSettings(readSettings().values).editorBorder !== "gray") return passthrough(str);
			try {
				return this.fg("borderMuted", str);
			} catch {
				return `${FALLBACK_BORDER_GRAY}${str}${RESET}`;
			}
		};
	};
	proto[BORDER_PATCH_FLAG] = true;
}
