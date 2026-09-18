import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { trackedTempDir } from "./sandbox-home.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const piBin = process.env.PI_TEST_BIN ?? resolve(repo, "node_modules/.bin/pi");
const fixture = resolve(here, "fixtures/ask-question-mouse-extension.ts");
const tmux = process.env.TMUX_BIN ?? "tmux";
const tmuxPrefix = ["-L", `claudify-ask-${process.pid}`];
const sandbox = trackedTempDir("claudify-ask-mouse-pty");
const home = join(sandbox, "home");
const statePath = join(sandbox, "state.json");
const stderrPath = join(sandbox, "stderr.log");
const session = `claudify-ask-mouse-${process.pid}`;
function run(command: string, args: string[], allowFailure = false): string { const result = spawnSync(command, args, { encoding: "utf8" }); if (!allowFailure && result.status !== 0) throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`); return result.stdout; }
function quote(value: string): string { return `'${value.replaceAll("'", `'\\''`)}'`; }
function capture(): string { return run(tmux, [...tmuxPrefix, "capture-pane", "-p", "-t", session], true); }
async function waitFor(label: string, predicate: () => boolean): Promise<void> { const deadline = Date.now() + 20_000; while (Date.now() < deadline) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error(`Timed out waiting for ${label}\n${capture()}\n${existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : ""}`); }
function pasteRaw(data: string): void { run(tmux, [...tmuxPrefix, "send-keys", "-t", session, "-H", ...[...Buffer.from(data, "binary")].map((value) => value.toString(16).padStart(2, "0"))]); }
function click(x: number, y: number): void { pasteRaw(`\x1b[<0;${x};${y}M\x1b[<0;${x};${y}m`); }
function row(text: string): number { return capture().split("\n").findIndex((line) => line.includes(text)) + 1; }
try {
	mkdirSync(home, { recursive: true });
	const command = [`cd ${quote(repo)} &&`, `HOME=${quote(home)}`, `PI_CLAUDIFY_ASK_MOUSE_STATE=${quote(statePath)}`, "PI_OFFLINE=1", "TERM=xterm-256color", quote(piBin), "--offline", "--approve", "--no-session", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-extensions", "--tui-mode", "fullscreen", "--extension", quote(fixture), `2>${quote(stderrPath)}`].join(" ");
	run(tmux, [...tmuxPrefix, "new-session", "-d", "-s", session, "-c", repo, "-x", "90", "-y", "42", command]);
	await waitFor("prompt", () => capture().includes("claude-opus") || capture().includes("/Users/"));
	await new Promise((resolve) => setTimeout(resolve, 2_000));
	run(tmux, [...tmuxPrefix, "send-keys", "-t", session, "/ask-mouse-probe single", "Enter"]);
	await waitFor("single question", () => row("2. TypeScript") > 0);
	click(3, row("2. TypeScript"));
	await waitFor("single mouse answer", () => existsSync(statePath));
	assert.equal(JSON.parse(readFileSync(statePath, "utf8")).answers["Pick a language?"], "TypeScript");
	console.log("real PTY AskUserQuestion mouse tests passed");
} finally {
	run(tmux, [...tmuxPrefix, "kill-server"], true);
}
