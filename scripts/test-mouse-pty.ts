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
const fixture = resolve(here, "fixtures/mouse-dispatch-extension.ts");
const sandbox = trackedTempDir("claudify-mouse-pty");
const home = join(sandbox, "home");
const statePath = join(sandbox, "state.json");
const stderrPath = join(sandbox, "pi.stderr.log");
const session = `claudify-mouse-${process.pid}`;

function run(command: string, args: string[], allowFailure = false): string {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (!allowFailure && result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
	}
	return result.stdout;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function sessionExists(): boolean {
	return spawnSync(tmux, ["has-session", "-t", session]).status === 0;
}

function capture(): string {
	return run(tmux, ["capture-pane", "-p", "-t", session]);
}

async function waitFor(description: string, predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "";
	throw new Error(`Timed out waiting for ${description}\n\n${capture()}\n\n${stderr}`);
}

interface FixtureState {
	one: boolean;
	two: boolean;
	setCalls: number;
	generation: number;
}

let lastFixtureState: FixtureState | undefined;
function state(): FixtureState {
	try {
		lastFixtureState = JSON.parse(readFileSync(statePath, "utf8"));
	} catch (error) {
		// The fixture rewrites this tiny diagnostic file synchronously. A PTY
		// observer can still land between truncate and write; retain the last good
		// generation so waitFor retries instead of turning that race into a failure.
		if (!lastFixtureState) throw error;
	}
	return lastFixtureState!;
}

function pasteRaw(data: string): void {
	const bytes = [...Buffer.from(data, "binary")].map((value) => value.toString(16).padStart(2, "0"));
	// `paste-buffer` enters bracketed-paste handling and intentionally bypasses
	// terminal mouse parsing. `send-keys -H` writes genuine PTY bytes.
	run(tmux, ["send-keys", "-t", session, "-H", ...bytes]);
}

function clickReport(x: number, y: number, button = 0): string {
	return `\x1b[<${button};${x};${y}M\x1b[<${button};${x};${y}m`;
}

run(tmux, ["kill-session", "-t", session], true);
const command = [
	`HOME=${shellQuote(home)}`,
	"PI_OFFLINE=1",
	`PI_CLAUDIFY_MOUSE_STATE=${shellQuote(statePath)}`,
	"TERM=xterm-256color",
	"COLORTERM=truecolor",
	shellQuote(piBin),
	"--offline",
	"--approve",
	"--no-session",
	"--no-context-files",
	"--no-skills",
	"--no-prompt-templates",
	"--no-themes",
	"--no-extensions",
	"--tui-mode",
	"fullscreen",
	"--extension",
	shellQuote(fixture),
	`2>${shellQuote(stderrPath)}`,
].join(" ");

try {
	run(tmux, ["new-session", "-d", "-s", session, "-c", sandbox, "-x", "100", "-y", "80", command]);
	await waitFor("fixture startup", () => existsSync(statePath)
		&& capture().includes("MOUSE_DISPATCH_READY")
		&& capture().includes("Ran 3 shell commands")
		&& capture().includes("Ran 4 shell commands"));
	assert.deepEqual(state(), { one: false, two: false, setCalls: 0, generation: 1 });

	let pane = capture();
	const paneLines = pane.split("\n");
	const readyY = paneLines.findIndex((line) => line.includes("MOUSE_DISPATCH_READY")) + 1;
	const firstY = paneLines.findIndex((line) => line.includes("Ran 3 shell commands")) + 1;
	assert.ok(readyY > 0 && firstY > 0, `fixture rows are visible in the real pane:\n${pane}`);
	pasteRaw(clickReport(3, readyY));
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.deepEqual(state(), { one: false, two: false, setCalls: 0, generation: 1 }, "clicking outside a group does not hit a neighbor");
	pasteRaw(clickReport(3, firstY, 2));
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.deepEqual(state(), { one: false, two: false, setCalls: 0, generation: 1 }, "secondary click does not expand a group");
	pasteRaw(clickReport(3, firstY));
	await waitFor("first group click", () => state().one === true);
	assert.deepEqual(state(), { one: true, two: false, setCalls: 3, generation: 1 }, "one SGR click expands all three commands in only its hit group");
	await waitFor("first group repaint", () => capture().includes("printf shell-one-1"));
	pasteRaw("\x0f");
	await waitFor("one-key pointer collapse", () => state().one === false && state().setCalls === 6);
	await waitFor("collapsed group repaint", () => capture().includes("Ran 3 shell commands"));
	assert.equal(state().two, false, "Ctrl+O collapse leaves the untouched four-command group collapsed");
	// Avoid Pi correctly classifying the next same-coordinate click as a double click.
	await new Promise((resolve) => setTimeout(resolve, 600));

	pane = capture();
	const reopenedFirstY = pane.split("\n").findIndex((line) => line.includes("Ran 3 shell commands")) + 1;
	pasteRaw(clickReport(3, reopenedFirstY));
	await waitFor("first group reopen", () => state().one === true && state().setCalls === 9);
	pane = capture();
	const secondY = pane.split("\n").findIndex((line) => line.includes("Ran 4 shell commands")) + 1;
	assert.ok(secondY > 0, `second group remains independently clickable:\n${pane}`);
	pasteRaw(`${clickReport(3, secondY)}${clickReport(3, secondY)}`);
	await waitFor("concatenated click batch", () => state().two === true && state().setCalls >= 13);
	assert.equal(state().one, true, "batched clicks do not collapse or retarget the first group");
	assert.equal(state().setCalls, 13, "the host coalesces duplicate press/release pairs into one four-member activation");
	assert.ok(!capture().includes("[<0;"), "SGR click reports never leak as editor text");

	const beforeWheel = state();
	pasteRaw("\x1b[<64;3;4M");
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.deepEqual(state(), beforeWheel, "wheel input does not activate a click target");
	pasteRaw("\x1b[<73;82;34M\x1b[<73;82;34M");
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.ok(!capture().includes("[<73;82;34M"), "concatenated non-click reports are consumed by the real input path");
	pasteRaw("\x0f");
	await waitFor("multi-group pointer collapse", () => !state().one && !state().two && state().setCalls === 20);
	const collapsedPane = capture();
	assert.ok(collapsedPane.includes("Ran 3 shell commands") && collapsedPane.includes("Ran 4 shell commands"), "one Ctrl+O restores both production shell summaries");

	assert.ok(capture().includes("MOUSE_DISPATCH_END"), "the native fullscreen frame remains intact after pointer batches");

	run(tmux, ["send-keys", "-t", session, "/reload", "Enter"]);
	await waitFor("extension reload", () => state().generation === 2 && capture().includes("Ran 3 shell commands"), 25_000);
	assert.deepEqual(state(), { one: false, two: false, setCalls: 0, generation: 2 }, "reload resets pointer state and member ownership");
	let reloadPane = capture();
	const reloadY = reloadPane.split("\n").findIndex((line) => line.includes("Ran 3 shell commands")) + 1;
	pasteRaw(clickReport(3, reloadY));
	await waitFor("post-reload click", () => state().one && state().setCalls === 3);
	pasteRaw("\x0f");
	await waitFor("post-reload one-key collapse", () => !state().one && state().setCalls === 6);
	assert.equal(state().generation, 2, "reload installs one listener rather than duplicating session handlers");

	run(tmux, ["send-keys", "-t", session, "/new", "Enter"]);
	await waitFor("new session lifecycle", () => state().generation === 3 && capture().includes("Ran 4 shell commands"), 25_000);
	assert.deepEqual(state(), { one: false, two: false, setCalls: 0, generation: 3 }, "new session starts with no stale pointer-expanded members");
	const generationBPane = capture();
	const generationBY = generationBPane.split("\n").findIndex((line) => line.includes("Ran 3 shell commands")) + 1;
	assert.ok(generationBY > 0, `generation-B group is visible after tree replacement:\n${generationBPane}`);
	pasteRaw(clickReport(3, generationBY));
	await waitFor("generation-B click", () => state().generation === 3 && state().one && state().setCalls === 3);
	pasteRaw("\x0f");
	await waitFor("generation-B one-key collapse", () => state().generation === 3 && !state().one && state().setCalls === 6);
	assert.equal(state().two, false, "generation-A registrations cannot retarget or consume generation-B interaction");

	run(tmux, ["send-keys", "-t", session, "C-d"]);
	await waitFor("native fullscreen teardown", () => !sessionExists());

	console.log("real PTY mouse dispatch tests passed");
} finally {
	run(tmux, ["kill-session", "-t", session], true);
}
