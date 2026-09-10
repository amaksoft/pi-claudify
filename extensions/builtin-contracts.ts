import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CORE_TOOL_NAMES = new Set(["read", "bash", "grep", "find", "ls", "write", "edit"]);

export function skippedToolOverrides(values: Record<string, unknown>, envValue = process.env.PI_CLAUDIFY_SKIP_TOOL_OVERRIDES ?? ""): Set<string> {
	const configured = Array.isArray(values.skipToolOverrides) ? values.skipToolOverrides : [];
	const fromEnv = envValue.split(",");
	return new Set(
		[...configured, ...fromEnv]
			.filter((value): value is string => typeof value === "string")
			.map((value) => value.trim().toLowerCase())
			.filter((value) => CORE_TOOL_NAMES.has(value)),
	);
}

export interface HostToolSettings {
	shellPath?: string;
	commandPrefix?: string;
	autoResizeImages: boolean;
}

export interface HostToolSettingsContext {
	/** Pi's effective global configuration directory. */
	agentDir: string;
	/** Project settings are executable configuration and require explicit trust. */
	projectTrusted?: boolean;
}

/**
 * Resolve Pi's global configuration directory through an optional namespace
 * capability, keeping module loading compatible across supported Pi releases.
 */
export function effectiveAgentDir(getAgentDir?: unknown): string {
	if (typeof getAgentDir === "function") {
		try {
			const value = getAgentDir();
			if (typeof value === "string" && value.length > 0) return value;
		} catch {
			// Fall through to the same environment/default resolution used by Pi.
		}
	}
	const home = process.env.HOME || homedir();
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (!configured) return join(home, ".pi", "agent");
	if (configured === "~") return home;
	if (configured.startsWith("~/")) return join(home, configured.slice(2));
	return configured;
}

/**
 * Mirror the settings Pi uses when constructing built-in tools. Extensions do
 * not receive SettingsManager, so read global settings followed by the trusted
 * project override. This affects execution only; claudify's own settings remain
 * user-scope by design.
 */
export function hostToolSettings(cwd: string, context: HostToolSettingsContext): HostToolSettings {
	const home = process.env.HOME || homedir();
	let shellPath: string | undefined;
	let commandPrefix: string | undefined;
	let autoResize: boolean | undefined;
	const paths = [join(context.agentDir, "settings.json")];
	if (context.projectTrusted === true) paths.push(join(cwd, ".pi", "settings.json"));
	for (const path of paths) {
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
	if (shellPath === "~") shellPath = home;
	else if (shellPath?.startsWith("~/")) shellPath = join(home, shellPath.slice(2));
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
