import assert from "node:assert/strict";

import { languageForPath } from "../extensions/domain/language.ts";
import { extractApplyPatchFiles, getRawStringArg, getStringArg, getStringArrayArg, getTextContent } from "../extensions/domain/tool-arguments.ts";
import { buildSearchCallView, buildTextResultView } from "../extensions/domain/tool-view.ts";
import { dirIcon, fileIcon } from "../extensions/render/file-icons.ts";

const shortPath = (path: string) => `short:${path}`;
assert.deepEqual(buildSearchCallView("grep", { pattern: "needle", path: "src" }, shortPath), {
	kind: "grep",
	label: "Grep",
	summary: '"needle" in short:src',
	pendingLabel: "Searching...",
	emptyLabel: "no matches",
	itemNoun: "matches",
});
assert.equal(buildSearchCallView("find", { pattern: "*.ts" }, shortPath).summary, '"*.ts"');
assert.equal(buildSearchCallView("ls", {}, shortPath).summary, "short:.");
assert.equal(buildSearchCallView("grep", { pattern: "x\x1b]0;spoof\x07" }, shortPath).summary, '"x"', "call models sanitize metadata before rendering");
assert.deepEqual(buildTextResultView({ content: [{ type: "text", text: "one\n\ntwo\n" }] }), { items: ["one", "two"], raw: "one\ntwo" });
assert.deepEqual(buildTextResultView({ content: [{ type: "image", data: "x" }] }), { items: [], raw: "" });
assert.match(fileIcon("src/index.ts"), /\ue628/, "known extensions receive their captured icon");
assert.match(fileIcon("unknown.custom"), /\uf15b/, "unknown extensions receive the default file icon");
assert.match(dirIcon(), /\ue5ff/, "directories use the directory icon");
assert.equal(languageForPath("src/component.TSX"), "tsx");
assert.equal(languageForPath("C:\\repo\\Dockerfile"), undefined);
assert.equal(languageForPath("script"), undefined);
assert.equal(getTextContent({ content: [{ type: "text", text: "one" }, { type: "image" }, { type: "text", text: "two" }] }), "one\ntwo");
assert.equal(getRawStringArg({ query: "  needle  " }, "path", "query"), "needle");
assert.equal(getStringArg({ query: "x\x1b]0;spoof\x07" }, "query"), "x");
assert.deepEqual(getStringArrayArg({ paths: [" a ", 4, "b"] }, "paths"), ["a", "b"]);
assert.deepEqual(extractApplyPatchFiles("*** Update File: a.ts\n@@\n*** Add File: b.ts\n*** Update File: a.ts"), ["a.ts", "b.ts"]);

console.log("tool view tests passed");
