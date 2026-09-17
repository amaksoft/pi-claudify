import { trackedTempDir } from "./sandbox-home.ts";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ToolExecutionComponent, createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import { DiffCardComponent, type DiffCardBuild } from "../extensions/diff-card.ts";
import extension, { parseDiff, selectAuthoritativeEditDiff } from "../extensions/index.ts";
import {
	MAX_WRITE_DIFF_INPUT_BYTES,
	MAX_WRITE_SNAPSHOT_BYTES,
	writeDiffOmissionReason,
} from "../extensions/write-snapshot.ts";

const root = trackedTempDir("cc-diff-persist");
const home = join(root, "home");
mkdirSync(join(home, ".pi"), { recursive: true });
process.env.HOME = home;
process.env.PI_CLAUDIFY_NATIVE_EXECUTION = "0";
process.chdir(root);

class FakePi {
	tools = new Map<string, any>();
	events = new Map<string, Array<(...args: any[]) => any>>();
	registerTool(definition: any): void { this.tools.set(definition.name, definition); }
	registerCommand(): void {}
	on(name: string, handler: (...args: any[]) => any): void {
		this.events.set(name, [...(this.events.get(name) ?? []), handler]);
	}
	getThinkingLevel(): string { return "off"; }
	getAllTools(): any[] { return [...this.tools.values()]; }
}

function pendingComponent(pi: FakePi, name: string, id: string, args: any): ToolExecutionComponent {
	const definition = pi.tools.get(name);
	assert.ok(definition, `${name} registered`);
	const component = new ToolExecutionComponent(
		name,
		id,
		args,
		{ showImages: false },
		definition,
		{ requestRender() {}, previousLines: [] } as any,
		root,
	);
	component.markExecutionStarted();
	component.setArgsComplete();
	return component;
}

function restoredComponent(pi: FakePi, name: string, id: string, args: any, persistedResult: any): ToolExecutionComponent {
	const definition = pi.tools.get(name);
	assert.ok(definition, `${name} registered`);
	const component = new ToolExecutionComponent(
		name,
		id,
		args,
		{ showImages: false },
		definition,
		{ requestRender() {}, previousLines: [] } as any,
		root,
	);
	component.markExecutionStarted();
	component.setArgsComplete();
	// JSON round-trip is the session boundary: renderer state/component instances
	// are gone; only serializable args and result details survive.
	component.updateResult({ ...JSON.parse(JSON.stringify(persistedResult)), isError: false }, false);
	return component;
}

function plain(lines: string[]): string {
	return lines.join("\n")
		.replace(/\x1b\]8;;[^\x07]*\x07/g, "")
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

async function rendered(component: ToolExecutionComponent, width: number): Promise<{ raw: string[]; text: string }> {
	let raw: string[] = [];
	for (let attempt = 0; attempt < 80; attempt++) {
		raw = component.render(width);
		if (!plain(raw).includes("rendering diff")) break;
		await new Promise((resolve) => setTimeout(resolve, 15));
	}
	return { raw, text: plain(raw) };
}

async function drainAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

type ControlledBuildCall = {
	width: number;
	resolve: (text: string) => void;
	reject: (error: unknown) => void;
};

function controlledBuild(): { build: DiffCardBuild; calls: ControlledBuildCall[] } {
	const calls: ControlledBuildCall[] = [];
	return {
		calls,
		build: (width) => new Promise<string>((resolve, reject) => {
			calls.push({ width, resolve, reject });
		}),
	};
}

const directTextRenderer = (text: string): string[] => [text];

// --- DiffCard async lifecycle: notifier failures are fully isolated. ---------
{
	const unhandled: unknown[] = [];
	const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
	process.on("unhandledRejection", onUnhandled);
	try {
		let successBuilds = 0;
		let successNotifications = 0;
		const success = new DiffCardComponent();
		success.configure(
			"throwing-success",
			"loading",
			async () => { successBuilds++; return "built"; },
			() => { successNotifications++; throw new Error("success notifier failed"); },
			directTextRenderer,
			"failed",
		);
		assert.deepEqual(success.render(60), ["loading"]);
		await drainAsyncWork();
		assert.deepEqual(success.render(60), ["built"], "throwing notifier does not replace a successful build");
		assert.equal(successBuilds, 1, "throwing success notifier does not retry the build");
		assert.equal(successNotifications, 1, "throwing success notifier is not retried as a failure notification");

		let failureBuilds = 0;
		let failureNotifications = 0;
		const failure = new DiffCardComponent();
		failure.configure(
			"throwing-failure",
			"loading",
			async () => { failureBuilds++; throw new Error("build failed"); },
			() => { failureNotifications++; throw new Error("failure notifier failed"); },
			directTextRenderer,
			"stable failure",
		);
		assert.deepEqual(failure.render(60), ["loading"]);
		await drainAsyncWork();
		assert.deepEqual(failure.render(60), ["stable failure"], "build failure remains cached when its notifier throws");
		assert.equal(failureBuilds, 1, "throwing failure notifier does not retry the build");
		assert.equal(failureNotifications, 1, "failure notifier runs exactly once");
		await drainAsyncWork();
		assert.deepEqual(unhandled, [], "throwing notifiers never produce an unhandled rejection");
	} finally {
		process.off("unhandledRejection", onUnhandled);
	}
}

// --- DiffCard key changes preserve geometry until async replacement is ready. -
{
	const card = new DiffCardComponent();
	card.configure("expanded", "loading", async () => "expanded rows", () => {}, directTextRenderer);
	assert.deepEqual(card.render(60), ["loading"]);
	await drainAsyncWork();
	assert.deepEqual(card.render(60), ["expanded rows"]);
	const collapsed = controlledBuild();
	card.configure("collapsed", "loading", collapsed.build, () => {}, directTextRenderer);
	assert.deepEqual(card.render(60), ["expanded rows"], "collapse keeps the completed frame instead of flashing a one-line placeholder");
	await drainAsyncWork();
	collapsed.calls[0].resolve("collapsed rows");
	await drainAsyncWork();
	assert.deepEqual(card.render(60), ["collapsed rows"]);
	const resized = controlledBuild();
	card.configure("resized", "loading", resized.build, () => {}, directTextRenderer);
	assert.deepEqual(card.render(20), ["loading"], "stale geometry is never reused at a different requested width");
	await drainAsyncWork();
	resized.calls[0].resolve("narrow rows");
	await drainAsyncWork();
	assert.deepEqual(card.render(20), ["narrow rows"]);
}

// --- DiffCard scheduler: one active + latest queued, obsolete work discarded. -
{
	const controlled = controlledBuild();
	let notifications = 0;
	const card = new DiffCardComponent();
	card.configure(
		"rapid-widths",
		"loading",
		controlled.build,
		() => { notifications++; },
		directTextRenderer,
		"failed",
	);

	for (let width = 21; width <= 120; width++) card.render(width);
	await drainAsyncWork();
	assert.deepEqual(controlled.calls.map((call) => call.width), [21], "100 rapid widths start only one build");

	controlled.calls[0]!.resolve("obsolete width 21");
	await drainAsyncWork();
	assert.deepEqual(
		controlled.calls.map((call) => call.width),
		[21, 120],
		"only the latest of 99 queued width identities starts",
	);
	assert.equal(notifications, 0, "obsolete completion does not notify");

	controlled.calls[1]!.resolve("latest width 120");
	await drainAsyncWork();
	assert.equal(notifications, 1, "latest completion notifies once");
	assert.deepEqual(card.render(120), ["latest width 120"]);
	assert.deepEqual(card.render(21), ["loading"], "obsolete completion was not cached");
	await drainAsyncWork();
	assert.deepEqual(controlled.calls.map((call) => call.width), [21, 120, 21]);
	controlled.calls[2]!.resolve("fresh width 21");
	await drainAsyncWork();
}

// --- DiffCard cache identity includes a presentation epoch at fixed width. ----
{
	let epoch = 1;
	const builtEpochs: number[] = [];
	const card = new DiffCardComponent();
	card.configure(
		"fixed-width-epoch",
		"loading",
		async () => {
			const builtEpoch = epoch;
			builtEpochs.push(builtEpoch);
			return `epoch ${builtEpoch}`;
		},
		() => {},
		directTextRenderer,
		"failed",
		() => epoch,
	);

	assert.deepEqual(card.render(72), ["loading"]);
	await drainAsyncWork();
	assert.deepEqual(card.render(72), ["epoch 1"]);
	epoch = 2;
	assert.deepEqual(card.render(72), ["loading"], "new presentation epoch invalidates a fixed-width cache entry");
	await drainAsyncWork();
	assert.deepEqual(card.render(72), ["epoch 2"]);
	assert.deepEqual(builtEpochs, [1, 2]);
}

initTheme("dark", false);
const pi = new FakePi();
for (const definition of [createEditToolDefinition(root), createWriteToolDefinition(root)]) {
	pi.tools.set(definition.name, { ...definition, sourceInfo: { source: "builtin", path: `<builtin:${definition.name}>` } });
}
extension(pi as any);

// --- Live edit preview: source-driven component reflows before execution. -----
const longOld = `const message = "${"old-segment-".repeat(10)}";`;
const longNew = `const message = "${"new-segment-".repeat(10)}";`;
writeFileSync("preview.ts", `${longOld}\nconst untouched = true;\n`);
const previewEdit = pendingComponent(pi, "edit", "preview-edit", {
	path: "preview.ts",
	edits: [{ oldText: longOld, newText: longNew }],
});
const previewWide = await rendered(previewEdit, 120);
const previewNarrow = await rendered(previewEdit, 44);
assert.match(previewWide.text, /old-segment-/);
assert.match(previewNarrow.text, /new-segment-/);
for (const line of previewNarrow.raw) {
	assert.ok(visibleWidth(line) <= 44, `narrow live-preview row fits width: ${JSON.stringify(line)}`);
}
assert.notEqual(previewNarrow.text, previewWide.text, "live preview recomputes when the terminal narrows");

// --- Native per-call edit patches beat broader post-execution snapshots. ------
const nativeOnly = parseDiff("const a = 1;\n", "const a = 2;\n");
const nativePatch = "@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;\n";
const selectedNative = selectAuthoritativeEditDiff(nativePatch)!;
assert.equal(selectedNative.added, nativeOnly.added);
assert.equal(selectedNative.removed, nativeOnly.removed);
assert.doesNotMatch(JSON.stringify(selectedNative), /const b/, "a sibling edit present only in the after-snapshot is not attributed to this call");
assert.equal(selectAuthoritativeEditDiff(undefined), null, "hosts without queue-owned patch or legacy diff omit edit history rather than trusting a snapshot");
const legacyNativeDiff = "-1 const a = 1;\n+1 const a = 2;\n 2 const tail = true;";
const selectedLegacy = selectAuthoritativeEditDiff(undefined, legacyNativeDiff)!;
assert.equal(selectedLegacy.added, 1, "Pi 0.74 queue-owned numbered diff is accepted as authoritative");
assert.equal(selectedLegacy.removed, 1, "Pi 0.74 numbered removals are preserved");
assert.equal(selectedLegacy.lines[2]?.content, "const tail = true;", "Pi 0.74 context is converted into the persisted model");
assert.equal(selectAuthoritativeEditDiff(nativePatch, legacyNativeDiff)?.lines[0]?.content, "const a = 1;", "standard patch takes precedence when both host formats exist");

// --- Edit: persisted standard patch survives a new component + changed file. --
const editArgs = {
	path: "edit.ts",
	edits: [{ oldText: "const b = 2;", newText: "const b = 20;" }],
};
writeFileSync("edit.ts", "const a = 1;\nconst b = 2;\n");
const editResult = await pi.tools.get("edit").execute("live-edit", editArgs, undefined, undefined, {});
const editHasNativePatch = typeof editResult.details?.patch === "string" && /^@@/m.test(editResult.details.patch);
assert.equal(editResult.details?._type, "editInfo");
if (editHasNativePatch) {
	assert.equal(editResult.details?.parsedDiff, undefined, "patch-capable hosts persist no redundant parsed render model");
	assert.ok(JSON.stringify(editResult.details).length < editResult.details.patch.length * 2 + 1_000, "persisted single-edit metadata remains bounded relative to its native patch");
} else {
	assert.ok(editResult.details?.diff, "Pi 0.74 retains its native display diff for kill-switch fallback");
	assert.ok(Array.isArray(editResult.details?.parsedDiff?.lines), "Pi 0.74 also converts its queue-owned numbered diff into one bounded persisted model");
}
const restoredPayload = JSON.parse(JSON.stringify(editResult));
delete restoredPayload.details.language;
// At this point the file already contains the NEW text. A restored renderer
// must rebuild from queue-owned persisted provenance, never reread the filesystem.
const restoredEdit = restoredComponent(pi, "edit", "restored-edit", editArgs, restoredPayload);
const editWide = await rendered(restoredEdit, 120);
assert.match(editWide.text, /const b = 2;/, "restored diff retains the removed side");
assert.match(editWide.text, /const b = 20;/, "restored diff retains the added side");
assert.doesNotMatch(editWide.text, /rendering diff/);
const editNarrow = await rendered(restoredEdit, 48);
assert.match(editNarrow.text, /const b = 2;/);
assert.match(editNarrow.text, /const b = 20;/);
for (const line of editNarrow.raw) assert.ok(visibleWidth(line) <= 48, `narrow edit row fits width: ${JSON.stringify(line)}`);
const editWideAgain = await rendered(restoredEdit, 120);
assert.equal(editWideAgain.text, editWide.text, "wide → narrow → wide is stable and width-keyed");

// --- Write overwrite: custom persisted ParsedDiff survives reconstruction. ----
const writeArgs = { path: "write.ts", content: "const value = 200;\nconst tail = true;\n" };
writeFileSync("write.ts", "const value = 2;\nconst tail = true;\n");
const writeResult = await pi.tools.get("write").execute("live-write", writeArgs, undefined, undefined, {});
assert.equal(writeResult.details?._type, "diff");
assert.ok(Array.isArray(writeResult.details?.diff?.lines), "write result persists the parsed diff model");
const restoredWrite = restoredComponent(pi, "write", "restored-write", writeArgs, writeResult);
const writeWide = await rendered(restoredWrite, 100);
assert.match(writeWide.text, /const value = 2;/, "restored write retains removed content");
assert.match(writeWide.text, /const value = 200;/, "restored write retains added content");
const writeNarrow = await rendered(restoredWrite, 42);
for (const line of writeNarrow.raw) {
	assert.ok(visibleWidth(line) <= 42, `narrow write row fits width: ${JSON.stringify(line)}`);
}
assert.notEqual(writeNarrow.text, writeWide.text, "resize recomputes rather than serving the old-width string");

// --- Multi-edit: separated Unicode hunks persist and resize safely. -----------
const unicodeOldA = `const greeting = "${"こんにちは🙂".repeat(8)}";`;
const unicodeNewA = `const greeting = "${"こんばんは🚀".repeat(8)}";`;
const unicodeOldB = `const family = "${"👨‍👩‍👧‍👦".repeat(8)}";`;
const unicodeNewB = `const family = "${"👩‍🚀".repeat(8)}";`;
const multiLines = Array.from({ length: 30 }, (_, index) => `const line${index + 1} = ${index + 1};`);
multiLines[2] = unicodeOldA;
multiLines[24] = unicodeOldB;
writeFileSync("multi.ts", `${multiLines.join("\n")}\n`);
const multiArgs = {
	path: "multi.ts",
	edits: [
		{ oldText: unicodeOldA, newText: unicodeNewA },
		{ oldText: unicodeOldB, newText: unicodeNewB },
	],
};
const multiResult = await pi.tools.get("edit").execute("live-multi", multiArgs, undefined, undefined, {});
const multiHasNativePatch = typeof multiResult.details?.patch === "string" && /^@@/m.test(multiResult.details.patch);
assert.equal(multiResult.details?._type, "multiEditInfo");
assert.equal(multiResult.details?.parsedDiffs, undefined, "operation-local models are never persisted");
if (multiHasNativePatch) {
	assert.equal(multiResult.details?.aggregateDiff, undefined, "multi-edit stores no redundant aggregate model beside native patch");
	assert.ok(JSON.stringify(multiResult.details).length < multiResult.details.patch.length * 2 + 1_000, "persisted multi-edit metadata remains bounded relative to its native patch");
} else {
	assert.ok(multiResult.details?.diff, "Pi 0.74 retains its native multi-edit display diff for kill-switch fallback");
	assert.ok(Array.isArray(multiResult.details?.aggregateDiff?.lines), "Pi 0.74 also converts its queue-owned aggregate diff into one bounded model");
}
const restoredMulti = restoredComponent(pi, "edit", "restored-multi", multiArgs, multiResult);
const multiWide = await rendered(restoredMulti, 120);
assert.match(multiWide.text, /Added 2 lines, removed 2 lines/);
assert.doesNotMatch(multiWide.text, /\(2 edits\)|Edit [12]\/2/, "Claude mode does not expose operation-level edit sections");
assert.match(multiWide.text, /^\s*3 [-+]/m, "aggregate diff keeps the first real file line number");
assert.match(multiWide.text, /^\s*25 [-+]/m, "aggregate diff keeps the second real file line number");
assert.match(multiWide.text, /const line2 = 2;/, "aggregate diff retains surrounding context");
assert.match(multiWide.text, /こんにちは🙂/);
assert.match(multiWide.text, /こんばんは🚀/);
assert.match(multiWide.text, /👨‍👩‍👧‍👦/);
assert.match(multiWide.text, /👩‍🚀/);
const multiNarrow = await rendered(restoredMulti, 44);
for (const line of multiNarrow.raw) assert.ok(visibleWidth(line) <= 44, `narrow multi-edit row fits width: ${JSON.stringify(line)}`);
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
assert.doesNotMatch(multiNarrow.text, loneSurrogate, "diff wrapping never splits a surrogate pair");
const multiWideAgain = await rendered(restoredMulti, 120);
assert.equal(multiWideAgain.text, multiWide.text, "multi-edit wide → narrow → wide is stable");

// Older sessions on patch-capable Pi have the standard patch but not
// claudify's parsedDiffs. Exercise that compatibility path where available.
if (typeof multiResult.details?.patch === "string" && /^@@/m.test(multiResult.details.patch)) {
	const legacyMultiResult = JSON.parse(JSON.stringify(multiResult));
	delete legacyMultiResult.details.aggregateDiff;
	delete legacyMultiResult.details.parsedDiffs;
	delete legacyMultiResult.details.editLines;
	delete legacyMultiResult.details.language;
	const restoredLegacyMulti = restoredComponent(pi, "edit", "restored-legacy-multi", multiArgs, legacyMultiResult);
	const legacyMulti = await rendered(restoredLegacyMulti, 70);
	assert.match(legacyMulti.text, /こんにちは🙂/);
	assert.match(legacyMulti.text, /こんばんは🚀/);
	assert.match(legacyMulti.text, /👨‍👩‍👧‍👦/);
	assert.match(legacyMulti.text, /👩‍🚀/);
	assert.match(legacyMulti.text, /^\s*3 [-+]/m, "first persisted hunk keeps its real line number");
	assert.match(legacyMulti.text, /^\s*25 [-+]/m, "second persisted hunk keeps its real line number");
}

// --- New-file limits apply before synthetic diff/listing construction. -------
assert.equal(writeDiffOmissionReason({ kind: "new" }, "x".repeat(MAX_WRITE_DIFF_INPUT_BYTES)), null, "new file at the byte limit is allowed");
assert.equal(writeDiffOmissionReason({ kind: "new" }, "x".repeat(MAX_WRITE_DIFF_INPUT_BYTES + 1)), "oversized", "new file above the byte limit is omitted");
const multibyteAtLimit = "🙂".repeat(MAX_WRITE_DIFF_INPUT_BYTES / 4);
assert.equal(Buffer.byteLength(multibyteAtLimit, "utf8"), MAX_WRITE_DIFF_INPUT_BYTES);
assert.equal(writeDiffOmissionReason({ kind: "new" }, `${multibyteAtLimit}🙂`), "oversized", "new-file limit counts UTF-8 bytes, not code units");

const oversizedNewArgs = { path: "large-new.txt", content: "n".repeat(MAX_WRITE_DIFF_INPUT_BYTES + 1) };
const oversizedNewResult = await pi.tools.get("write").execute("large-new-write", oversizedNewArgs, undefined, undefined, {});
assert.deepEqual(
	{ type: oversizedNewResult.details?._type, reason: oversizedNewResult.details?.reason },
	{ type: "diffOmitted", reason: "oversized" },
	"oversized new files persist bounded omission details",
);
const restoredOversizedNew = restoredComponent(pi, "write", "restored-large-new", oversizedNewArgs, oversizedNewResult);
assert.match((await rendered(restoredOversizedNew, 80)).text, /diff omitted: file too large/);

// No authoritative patch or bounded preimage: say unavailable, never invent
// operation-local line 1 coordinates/order.
const unavailableEdit = restoredComponent(pi, "edit", "restored-unavailable-edit", {
	path: "unknown.ts",
	edits: [
		{ oldText: "late", newText: "later" },
		{ oldText: "early", newText: "earlier" },
	],
}, {
	content: [{ type: "text", text: "Applied edits" }],
	details: { _type: "diffUnavailable", summary: "+2 -2", editCount: 2, language: "typescript" },
});
const unavailableView = await rendered(unavailableEdit, 80);
assert.match(unavailableView.text, /diff unavailable: source provenance not captured/);
assert.doesNotMatch(unavailableView.text, /at line 1|Edit 1\/2/, "unavailable provenance never fabricates coordinates or argument order");

// --- Oversized overwrite: no unbounded snapshot/diff construction. -----------
const oversizedOld = `${"x".repeat(MAX_WRITE_SNAPSHOT_BYTES + 1)}\n`;
writeFileSync("large.txt", oversizedOld);
const oversizedArgs = { path: "large.txt", content: "replacement\n" };
const oversizedResult = await pi.tools.get("write").execute("large-write", oversizedArgs, undefined, undefined, {});
assert.deepEqual(
	{ type: oversizedResult.details?._type, reason: oversizedResult.details?.reason },
	{ type: "diffOmitted", reason: "oversized" },
	"large prior files skip snapshot diffing explicitly",
);
assert.equal(oversizedResult.details?.diff, undefined, "oversized result does not persist a huge parsed diff");
const restoredOversized = restoredComponent(pi, "write", "restored-large", oversizedArgs, oversizedResult);
const oversizedView = await rendered(restoredOversized, 80);
assert.match(oversizedView.text, /diff omitted: file too large/, "restored row explains why no diff is available");

console.log("diff persistence and resize tests passed");
