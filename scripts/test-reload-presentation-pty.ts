import { trackedTempDir } from "./sandbox-home.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const tmux = process.env.TMUX_BIN ?? "tmux";
const piBin = resolve(repo, "node_modules/.bin/pi");
const fixture = resolve(here, "fixtures/reload-presentation-extension.ts");
const sandbox = trackedTempDir("claudify-reload-presentation");
const home = join(sandbox, "home");
const statePath = join(sandbox, "state.json");
const stderrPath = join(sandbox, "pi.stderr.log");
const session = `claudify-reload-presentation-${process.pid}`;

function run(command: string, args: string[], allowFailure = false): string {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (!allowFailure && result.status !== 0) throw new Error(`${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
function quote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'`; }
function capture(): string { return run(tmux, ["capture-pane", "-p", "-t", session]); }
function captureAnsi(): string { return run(tmux, ["capture-pane", "-e", "-p", "-t", session]); }
async function waitFor(label: string, predicate: () => boolean, timeoutMs = 25_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out waiting for ${label}\n${capture()}\n${existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : ""}`);
}

run(tmux, ["kill-session", "-t", session], true);
const command = [
	`HOME=${quote(home)}`,
	"PI_OFFLINE=1",
	`PI_CLAUDIFY_RELOAD_STATE=${quote(statePath)}`,
	"TERM=xterm-256color",
	"COLORTERM=truecolor",
	quote(piBin),
	"--offline", "--approve", "--no-session", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-extensions",
	"--tui-mode", "fullscreen", "--extension", quote(fixture),
	`2>${quote(stderrPath)}`,
].join(" ");

try {
	run(tmux, ["new-session", "-d", "-s", session, "-c", sandbox, "-x", "100", "-y", "40", command]);
	await waitFor("initial adapted edit and historical Bash group", () => capture().includes("RELOAD_PRESENTATION_GENERATION_1") && capture().includes("Update(reload-edit.ts)") && capture().includes("Ran 2 shell commands"));
	assert.doesNotMatch(capture(), /^edit reload-edit\.ts/m);
	assert.doesNotMatch(capture(), /native bash [12]/, "historical Bash rows never use their native renderer");
	run(tmux, ["send-keys", "-t", session, "/reload", "Enter"]);
	await waitFor("reloaded historical edit and Bash group", () => capture().includes("RELOAD_PRESENTATION_GENERATION_2")
		&& capture().includes("Update(reload-edit.ts)")
		&& capture().includes("Added 1 line, removed 1 line")
		&& capture().includes("Ran 2 shell commands"));
	const reloaded = capture();
	assert.doesNotMatch(reloaded, /^edit reload-edit\.ts/m, "historical edit never falls back to its native pre-adapter renderer");
	assert.match(reloaded, /Added 1 line, removed 1 line/, "historical settled diff survives reload presentation rebinding");
	assert.match(reloaded, /Ran 2 shell commands/, "zero-height assistant separators do not split historical Bash grouping after reload");
	assert.doesNotMatch(reloaded, /native bash [12]/);
	const ansiRows = captureAnsi().split("\n");
	const header = ansiRows.find((line) => line.includes("Update(reload-edit.ts)")) ?? "";
	const summary = ansiRows.find((line) => line.includes("Added 1 line, removed 1 line")) ?? "";
	assert.doesNotMatch(header, /\x1b\[48;/, "reloaded call header has no stale Pi success background");
	assert.doesNotMatch(summary, /\x1b\[48;/, "reloaded result summary has no stale Pi success background");
	run(tmux, ["send-keys", "-t", session, "C-d"]);
	console.log("real PTY reload presentation tests passed");
} finally {
	run(tmux, ["kill-session", "-t", session], true);
}
