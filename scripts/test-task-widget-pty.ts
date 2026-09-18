import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { trackedTempDir } from "./sandbox-home.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const piBin = process.env.PI_TEST_BIN ?? resolve(repo, "node_modules/.bin/pi");
const fixture = resolve(here, "fixtures/task-widget-extension.ts");
const tmux = process.env.TMUX_BIN ?? "tmux";
const socket = `claudify-task-${process.pid}`;
const sandbox = trackedTempDir("claudify-task-widget-pty");
const home = join(sandbox, "home"), agentDir = join(sandbox, "agent"), stderrPath = join(sandbox, "stderr.log");
const externalFixture = join(sandbox, "task-widget-wrapper.ts");
const session = `claudify-task-widget-${process.pid}`;
function run(command: string, args: string[], allowFailure = false): string { const result = spawnSync(command, args, { encoding: "utf8" }); if (!allowFailure && result.status !== 0) throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`); return result.stdout; }
function quote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'`; }
function capture(): string { return run(tmux, ["-L", socket, "capture-pane", "-p", "-t", session], true); }
async function waitFor(label: string, predicate: () => boolean): Promise<void> { const deadline = Date.now() + 20_000; while (Date.now() < deadline) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error(`Timed out waiting for ${label}\n${capture()}\n${readFileSync(stderrPath, "utf8")}`); }
try {
	mkdirSync(home, { recursive: true }); mkdirSync(agentDir, { recursive: true });
	writeFileSync(externalFixture, `export { default } from ${JSON.stringify(fixture)};\n`);
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [repo], quietStartup: true, theme: "dark" }));
	const command = [`cd ${quote(repo)} &&`, `HOME=${quote(home)}`, `PI_CODING_AGENT_DIR=${quote(agentDir)}`, "PI_OFFLINE=1", "TERM=xterm-256color", quote(piBin), "--offline", "--approve", "--no-session", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-themes", "--extension", quote(externalFixture), `2>${quote(stderrPath)}`].join(" ");
	run(tmux, ["-L", socket, "new-session", "-d", "-s", session, "-c", repo, "-x", "100", "-y", "42", command]);
	await waitFor("adapted task widget", () => capture().includes("3 tasks (1 done, 1 in progress, 1 open)") && capture().includes("Completed sample"));
	const pane = capture();
	assert.doesNotMatch(pane, /#1 Completed|11m 50s|9\.8k/, "task adapter hides IDs and per-task metrics");
	assert.match(pane, /✔ .*Completed sample/);
	assert.match(pane, /◼ Sampling active task color/, "uncached active rows preserve the external active text while removing metrics");
	assert.match(pane, /◻ Pending sample › blocked by #2/);
	console.log("real PTY task widget tests passed");
} finally {
	run(tmux, ["-L", socket, "kill-server"], true);
	rmSync(sandbox, { recursive: true, force: true });
}
