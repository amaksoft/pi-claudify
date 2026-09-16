import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

import extension from "../extensions/index.ts";
import { MAX_WRITE_SNAPSHOT_BYTES } from "../extensions/write-snapshot.ts";

const root = mkdtempSync(join(tmpdir(), "cc-diff-persist-"));
const home = join(root, "home");
mkdirSync(join(home, ".pi"), { recursive: true });
process.env.HOME = home;
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
		.replace(/\x1b\[[0-9;]*m/g, "");
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

initTheme("dark", false);
const pi = new FakePi();
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

// --- Edit: persisted standard patch survives a new component + changed file. --
const editArgs = {
	path: "edit.ts",
	edits: [{ oldText: "const b = 2;", newText: "const b = 20;" }],
};
writeFileSync("edit.ts", "const a = 1;\nconst b = 2;\n");
const editResult = await pi.tools.get("edit").execute("live-edit", editArgs, undefined, undefined, {});
assert.equal(editResult.details?._type, "editInfo");
assert.ok(editResult.details?.parsedDiff, "claudify persists its render model on every supported host");
// Pi >=0.80 also supplies a standard patch, used to restore older sessions that
// predate parsedDiff. Pi 0.74 lacks it, so the compatibility lane exercises the
// always-present custom model instead.
const restoredPayload = JSON.parse(JSON.stringify(editResult));
if (typeof restoredPayload.details.patch === "string" && /^@@/m.test(restoredPayload.details.patch)) {
	delete restoredPayload.details.parsedDiff;
	delete restoredPayload.details.parsedDiffs;
	delete restoredPayload.details.language;
}
// At this point the file already contains the NEW text. A restored renderer that
// rereads the filesystem can no longer reconstruct the old side.
const restoredEdit = restoredComponent(pi, "edit", "restored-edit", editArgs, restoredPayload);
const editWide = await rendered(restoredEdit, 120);
assert.match(editWide.text, /const b = 2;/, "restored diff retains the removed side");
assert.match(editWide.text, /const b = 20;/, "restored diff retains the added side");
assert.doesNotMatch(editWide.text, /rendering diff/);

// Same component, no updateResult/updateDisplay: render(width) owns reflow.
const editNarrow = await rendered(restoredEdit, 48);
assert.match(editNarrow.text, /const b = 2;/);
assert.match(editNarrow.text, /const b = 20;/);
for (const line of editNarrow.raw) {
	assert.ok(visibleWidth(line) <= 48, `narrow edit row fits width: ${JSON.stringify(line)}`);
}
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
assert.equal(multiResult.details?._type, "multiEditInfo");
assert.equal(multiResult.details?.parsedDiffs?.length, 2, "each edit persists its localized diff");
const restoredMulti = restoredComponent(pi, "edit", "restored-multi", multiArgs, multiResult);
const multiWide = await rendered(restoredMulti, 120);
assert.match(multiWide.text, /2 edits/);
assert.match(multiWide.text, /こんにちは🙂/);
assert.match(multiWide.text, /こんばんは🚀/);
assert.match(multiWide.text, /👨‍👩‍👧‍👦/);
assert.match(multiWide.text, /👩‍🚀/);
const multiNarrow = await rendered(restoredMulti, 44);
for (const line of multiNarrow.raw) {
	assert.ok(visibleWidth(line) <= 44, `narrow multi-edit row fits width: ${JSON.stringify(line)}`);
}
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
assert.doesNotMatch(multiNarrow.text, loneSurrogate, "diff wrapping never splits a surrogate pair");
const multiWideAgain = await rendered(restoredMulti, 120);
assert.equal(multiWideAgain.text, multiWide.text, "multi-edit wide → narrow → wide is stable");

// Older sessions on patch-capable Pi have the standard patch but not
// claudify's parsedDiffs. Exercise that compatibility path where available.
if (typeof multiResult.details?.patch === "string" && /^@@/m.test(multiResult.details.patch)) {
	const legacyMultiResult = JSON.parse(JSON.stringify(multiResult));
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
