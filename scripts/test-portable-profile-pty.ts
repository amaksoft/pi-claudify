import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { trackedTempDir } from "./sandbox-home.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const piBin = process.env.PI_TEST_BIN ?? resolve(repo, "node_modules/.bin/pi");
const packageSource = process.env.PI_CLAUDIFY_PACKAGE ?? repo;
const fixture = resolve(here, "fixtures/tool-registration-extension.ts");
const tmux = process.env.TMUX_BIN ?? "tmux";
const sandbox = trackedTempDir("claudify-portable-profile-pty");
const agentDir = join(sandbox, "agent");
const home = join(sandbox, "home");
const statePath = join(sandbox, "state.json");
const stderrPath = join(sandbox, "stderr.log");
const session = `claudify-portable-profile-${process.pid}`;

function run(command: string, args: string[], allowFailure = false): string {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (!allowFailure && result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
function quote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'`; }
function capture(): string { return run(tmux, ["capture-pane", "-p", "-t", session], true); }
async function waitFor(label: string, predicate: () => boolean, timeout = 20_000): Promise<void> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
	throw new Error(`Timed out waiting for ${label}\n${capture()}\n${existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : ""}`);
}
function snapshots(): any[] { try { return JSON.parse(readFileSync(statePath, "utf8")); } catch { return []; } }
function assertPortable(snapshot: any): void {
	const names = new Set(snapshot.tools.map((tool: any) => tool.name));
	for (const name of ["CronCreate", "CronList", "CronDelete", "AskUserQuestion"]) {
		assert.equal(names.has(name), true, `${name} remains available through documented public tool APIs`);
	}
	for (const tool of snapshot.tools) {
		if (["read", "write", "edit", "bash", "grep", "find", "ls"].includes(String(tool.name).toLowerCase())) {
			assert.equal(tool.sourceInfo?.source, "builtin", `${tool.name} keeps builtin execution ownership`);
		}
	}
}

try {
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(home, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [packageSource], quietStartup: true, theme: "dark" }));
	run(tmux, ["kill-session", "-t", session], true);
	const command = [
		`HOME=${quote(home)}`,
		`PI_CODING_AGENT_DIR=${quote(agentDir)}`,
		`PI_CLAUDIFY_TOOL_REGISTRY_STATE=${quote(statePath)}`,
		"PI_CLAUDIFY_PROFILE=portable", "PI_OFFLINE=1", "TERM=xterm-256color", quote(piBin), "--offline", "--approve", "--no-session",
		"--no-context-files", "--no-skills", "--no-prompt-templates", "--no-themes", "--extension", quote(fixture), `2>${quote(stderrPath)}`,
	].join(" ");
	run(tmux, ["new-session", "-d", "-s", session, "-x", "110", "-y", "42", command]);
	await waitFor("portable registry snapshot", () => snapshots().some((entry) => entry.generation === 1));
	assertPortable(snapshots().find((entry) => entry.generation === 1));
	run(tmux, ["send-keys", "-t", session, "/reload", "Enter"]);
	await waitFor("portable reload snapshot", () => snapshots().some((entry) => entry.generation >= 2));
	assertPortable(snapshots().at(-1));
	assert.doesNotMatch(capture(), /Claudify preserved native/i);
	console.log("real PTY portable profile tests passed");
} finally {
	run(tmux, ["kill-session", "-t", session], true);
	rmSync(sandbox, { recursive: true, force: true });
}
