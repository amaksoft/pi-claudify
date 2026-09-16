import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HostToolSettings {
	shellPath?: string;
	commandPrefix?: string;
	autoResizeImages: boolean;
}

/**
 * Mirror the settings Pi uses when constructing built-in tools. Extensions do
 * not receive SettingsManager, so read global settings followed by the trusted
 * project override. This affects execution only; claudify's own settings remain
 * user-scope by design.
 */
export function hostToolSettings(cwd: string): HostToolSettings {
	const home = process.env.HOME || homedir();
	let shellPath: string | undefined;
	let commandPrefix: string | undefined;
	let autoResize: boolean | undefined;
	for (const path of [join(home, ".pi", "agent", "settings.json"), join(cwd, ".pi", "settings.json")]) {
		try {
			if (!existsSync(path)) continue;
			const raw = JSON.parse(readFileSync(path, "utf8")) as {
				shellPath?: unknown;
				shellCommandPrefix?: unknown;
				images?: { autoResize?: unknown };
			};
			if (typeof raw.shellPath === "string") shellPath = raw.shellPath;
			if (typeof raw.shellCommandPrefix === "string") commandPrefix = raw.shellCommandPrefix;
			if (typeof raw.images?.autoResize === "boolean") autoResize = raw.images.autoResize;
		} catch {
			// Host also degrades to defaults for unreadable settings.
		}
	}
	if (shellPath?.startsWith("~")) shellPath = join(home, shellPath.slice(1));
	return { shellPath, commandPrefix, autoResizeImages: autoResize ?? true };
}

/** Presentation overrides must preserve contributions to Pi's system prompt. */
export function forwardedToolContract(definition: any): Record<string, unknown> {
	return {
		promptSnippet: definition?.promptSnippet,
		promptGuidelines: definition?.promptGuidelines,
		prepareArguments: definition?.prepareArguments,
	};
}
