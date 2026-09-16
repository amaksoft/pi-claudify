import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { trackedTempDir } from "./sandbox-home.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const piBin = process.env.PI_TEST_BIN ?? resolve(repo, "node_modules/.bin/pi");
const fixture = resolve(here, "fixtures/nested-owner-extension.ts");
const tmux = process.env.TMUX_BIN ?? "tmux";
const sandbox = trackedTempDir("claudify-nested-owner-pty");
const home = join(sandbox, "home");
const agentDir = join(sandbox, "agent");
const statePath = join(sandbox, "state.json");
const stderrPath = join(sandbox, "stderr.log");
const session = `claudify-nested-owner-${process.pid}`;
function run(command: string, args: string[], allowFailure = false): string { const result = spawnSync(command, args, { encoding: "utf8" }); if (!allowFailure && result.status !== 0) throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`); return result.stdout; }
function quote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'`; }
function capture(): string { return run(tmux, ["capture-pane", "-p", "-t", session], true); }
async function waitFor(label: string, predicate: () => boolean): Promise<void> { const deadline = Date.now() + 20_000; while (Date.now() < deadline) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error(`Timed out waiting for ${label}\n${capture()}\n${existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : ""}`); }
try {
	mkdirSync(home, { recursive: true }); mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [repo], quietStartup: true, theme: "dark" }));
	run(tmux, ["kill-session", "-t", session], true);
	const command = [`HOME=${quote(home)}`, `PI_CODING_AGENT_DIR=${quote(agentDir)}`, `PI_CLAUDIFY_NESTED_OWNER_STATE=${quote(statePath)}`, "PI_OFFLINE=1", "TERM=xterm-256color", quote(piBin), "--offline", "--approve", "--no-session", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-themes", "--extension", quote(fixture), `2>${quote(stderrPath)}`].join(" ");
	run(tmux, ["new-session", "-d", "-s", session, "-x", "100", "-y", "40", command]);
	await waitFor("prompt", () => capture().includes("❯"));
	run(tmux, ["send-keys", "-t", session, "/repro-nested-owner", "Enter"]);
	await waitFor("nested owner result", () => existsSync(statePath));
	const result = JSON.parse(readFileSync(statePath, "utf8"));
	assert.deepEqual(result, { beforeNative: false, duringNative: false, afterNative: false }, "child extension teardown restores the still-running parent renderer");
	console.log("real PTY nested owner-stack tests passed");
} finally {
	run(tmux, ["kill-session", "-t", session], true);
	rmSync(sandbox, { recursive: true, force: true });
}
