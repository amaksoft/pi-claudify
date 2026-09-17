import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { debugDiagnostic } from "../debug.ts";
import { sanitizeToolText } from "../terminal-sanitize.ts";

// ---------------------------------------------------------------------------
// Path display + OSC 8 hyperlink helpers shared by the built-in tool
// presenters (read/write/edit/bash/search/apply_patch). Claude Code does not
// tint file paths — it wraps them in an OSC 8 hyperlink so the terminal makes
// them clickable, leaving the color to the terminal; emphasis comes from
// bold, not hue.
//
// This domain/ module must not import Pi host packages or perform host I/O
// (enforced by scripts/test-architecture-boundaries.ts).
// ---------------------------------------------------------------------------

export function osc8Link(target: string, label: string): string {
	const safeLabel = sanitizeToolText(label);
	if (!target) return safeLabel;
	try {
		const wellFormedTarget = typeof target.toWellFormed === "function"
			? target.toWellFormed()
			: target.replace(/[\uD800-\uDFFF]/g, "\ufffd");
		const uri = pathToFileURL(wellFormedTarget).href;
		return `\x1b]8;;${uri}\x07${safeLabel}\x1b]8;;\x07`;
	} catch (error) {
		debugDiagnostic("osc8-path", error);
		return safeLabel;
	}
}

/** Absolute path for the link target; the label stays the short display path. */
export function linkedPath(cwd: string, displayPath: string, absolutePath?: string): string {
	if (!displayPath) return displayPath;
	const target = absolutePath ?? (displayPath.startsWith("/") ? displayPath : resolve(cwd, displayPath));
	return osc8Link(target, displayPath);
}

/** Relative display path when inside cwd, `~`-shortened otherwise. */
export function shortPath(cwd: string, filePath: string): string {
	if (!filePath) return "";
	const rel = relative(cwd, filePath);
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const display = !rel.startsWith("..") && !rel.startsWith("/")
		? rel || "."
		: home ? filePath.replace(home, "~") : filePath;
	return sanitizeToolText(display);
}
