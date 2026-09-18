import { trackedTempDir } from "./sandbox-home.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const piBin = process.env.PI_TEST_BIN ?? resolve(repo, "node_modules/.bin/pi");
const packageSource = process.env.PI_CLAUDIFY_PACKAGE ?? repo;
const fixture = resolve(here, "fixtures/tool-registration-extension.ts");
const tmux = process.env.TMUX_BIN ?? "tmux";
const sandbox = trackedTempDir("claudify-tool-registration-pty");
const tmuxTempDir = `/tmp/claudify-tmux-${process.pid}`;
process.env.TMUX_TMPDIR = tmuxTempDir;
mkdirSync(tmuxTempDir, { recursive: true });
const agentDir = join(sandbox, "agent");
const home = join(sandbox, "home");
const statePath = join(sandbox, "state.json");
const stderrPath = join(sandbox, "stderr.log");
const session = `claudify-tool-registration-${process.pid}`;

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
function assertTools(snapshot: any): void {
	const names = new Set(snapshot.tools.map((tool: any) => tool.name));
	for (const name of ["CronCreate", "CronList", "CronDelete", "AskUserQuestion"]) {
		assert.ok(names.has(name), `${name} is effective after complete startup fan-out`);
		assert.ok(new Set(snapshot.active).has(name), `${name} is active and model-visible in interactive TUI mode`);
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
		"PI_OFFLINE=1", "TERM=xterm-256color", quote(piBin), "--offline", "--approve", "--no-session",
		"--no-context-files", "--no-skills", "--no-prompt-templates", "--no-themes",
		"--extension", quote(fixture),
		`2>${quote(stderrPath)}`,
	].join(" ");
	run(tmux, ["new-session", "-d", "-s", session, "-x", "110", "-y", "42", command]);
	await waitFor("first registry snapshot", () => snapshots().some((entry) => entry.generation === 1));
	assertTools(snapshots().find((entry) => entry.generation === 1));
	run(tmux, ["send-keys", "-t", session, "/reload", "Enter"]);
	await waitFor("reloaded registry snapshot", () => snapshots().some((entry) => entry.generation >= 2));
	assertTools(snapshots().at(-1));
	run(tmux, ["send-keys", "-t", session, "/reload", "Enter"]);
	await waitFor("second reloaded registry snapshot", () => snapshots().some((entry) => entry.generation >= 3));
	assertTools(snapshots().at(-1));
	assert.doesNotMatch(capture(), /ownership could not be verified/i);
	console.log("real PTY tool registration tests passed");
} finally {
	run(tmux, ["kill-session", "-t", session], true);
	rmSync(sandbox, { recursive: true, force: true });
	rmSync(tmuxTempDir, { recursive: true, force: true });
}
