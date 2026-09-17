import assert from "node:assert/strict";

import { createEditToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";

import {
	createEditToolPresentation,
	registerEditTool,
	type EditToolPresentationRuntime,
	type EditToolRuntime,
} from "../extensions/tools/edit-tool.ts";
import {
	createWriteToolPresentation,
	registerWriteTool,
	type WriteToolPresentationRuntime,
	type WriteToolRuntime,
} from "../extensions/tools/write-tool.ts";

function assertPresentationOnly(presentation: object, name: "write" | "edit"): void {
	assert.deepEqual(
		Object.keys(presentation).sort(),
		["name", "overrideSelfShell", "renderCall", "renderResult"],
		`${name} presentation exposes only presentation fields`,
	);
	assert.equal((presentation as any).name, name);
	assert.equal((presentation as any).overrideSelfShell, true);
	assert.equal(typeof (presentation as any).renderCall, "function");
	assert.equal(typeof (presentation as any).renderResult, "function");
	assert.equal("execute" in presentation, false);
	assert.equal("parameters" in presentation, false);
	assert.equal("schema" in presentation, false);
}

const writePresentation = createWriteToolPresentation({} as WriteToolPresentationRuntime);
const editPresentation = createEditToolPresentation({} as EditToolPresentationRuntime);
assertPresentationOnly(writePresentation, "write");
assertPresentationOnly(editPresentation, "edit");

const cwd = process.cwd();
let registeredWrite: any;
const writeRuntime = {
	cwd,
	register(definition: any) { registeredWrite = definition; },
	registerExecution: true,
	registerPresentation() {},
	forwardContract() { return { promptSnippet: "forwarded write contract" }; },
} as unknown as WriteToolRuntime;
registerWriteTool(writeRuntime);
const nativeWrite = createWriteToolDefinition(cwd);
assert.equal(registeredWrite.name, "write");
assert.equal(registeredWrite.label, "write");
assert.equal(registeredWrite.description, nativeWrite.description);
assert.deepEqual(registeredWrite.parameters, nativeWrite.parameters);
assert.equal(registeredWrite.promptSnippet, "forwarded write contract");
assert.equal(typeof registeredWrite.execute, "function");
assert.equal(typeof registeredWrite.renderCall, "function");
assert.equal(typeof registeredWrite.renderResult, "function");

let registeredEdit: any;
const editRuntime = {
	cwd,
	register(definition: any) { registeredEdit = definition; },
	registerExecution: true,
	registerPresentation() {},
	forwardContract() { return { prepareArguments: "forwarded edit contract" }; },
} as unknown as EditToolRuntime;
registerEditTool(editRuntime);
const nativeEdit = createEditToolDefinition(cwd);
assert.equal(registeredEdit.name, "edit");
assert.equal(registeredEdit.label, "edit");
assert.equal(registeredEdit.description, nativeEdit.description);
assert.deepEqual(registeredEdit.parameters, nativeEdit.parameters);
assert.equal(registeredEdit.prepareArguments, "forwarded edit contract");
assert.equal(typeof registeredEdit.execute, "function");
assert.equal(typeof registeredEdit.renderCall, "function");
assert.equal(typeof registeredEdit.renderResult, "function");

console.log("mutation presentation factory tests passed");
