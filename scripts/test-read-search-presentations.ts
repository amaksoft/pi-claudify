import assert from "node:assert/strict";

import {
	createReadToolPresentation,
	registerReadTool,
	type ReadToolPresentationRuntime,
	type ReadToolRuntime,
} from "../extensions/tools/read-tool.ts";
import {
	createSearchToolPresentation,
	registerSearchTools,
	type SearchToolPresentationRuntime,
	type SearchToolRuntime,
} from "../extensions/tools/search-tools.ts";

function untouchedRuntime<T extends object>(label: string): T {
	return new Proxy(Object.create(null), {
		get(_target, property) {
			throw new Error(`${label} presentation factory accessed runtime.${String(property)}`);
		},
	}) as T;
}

function assertPresentation(adapter: object, name: string): void {
	const record = adapter as Record<string, unknown>;
	assert.deepEqual(Object.keys(record).sort(), ["name", "overrideSelfShell", "renderCall", "renderResult"]);
	assert.equal(record.overrideSelfShell, true);
	assert.equal(record.name, name);
	assert.equal(typeof record.renderCall, "function");
	assert.equal(typeof record.renderResult, "function");
	assert.equal("execute" in record, false);
	assert.equal("parameters" in record, false);
	assert.equal("schema" in record, false);
}

assertPresentation(
	createReadToolPresentation(untouchedRuntime<ReadToolPresentationRuntime>("read")),
	"read",
);
for (const name of ["grep", "find", "ls"] as const) {
	assertPresentation(
		createSearchToolPresentation(name, untouchedRuntime<SearchToolPresentationRuntime>(name)),
		name,
	);
}

function registrationRuntime<T extends object>(definitions: any[]): T {
	const supported = {
		cwd: process.cwd(),
		forwardContract: () => ({ contractSentinel: true }),
		register: (definition: any) => definitions.push(definition),
		registerExecution: true,
		registerPresentation() {},
	};
	return new Proxy(supported, {
		get(target, property, receiver) {
			if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
			throw new Error(`registration unexpectedly accessed runtime.${String(property)}`);
		},
	}) as T;
}

const readDefinitions: any[] = [];
registerReadTool(registrationRuntime<ReadToolRuntime>(readDefinitions));
assert.equal(readDefinitions.length, 1);

const searchDefinitions: any[] = [];
registerSearchTools(registrationRuntime<SearchToolRuntime>(searchDefinitions));
assert.deepEqual(searchDefinitions.map((definition) => definition.name), ["grep", "find", "ls"]);

for (const definition of [...readDefinitions, ...searchDefinitions]) {
	assert.equal(typeof definition.description, "string");
	assert.ok(definition.parameters);
	assert.equal(typeof definition.execute, "function");
	assert.equal(typeof definition.renderCall, "function");
	assert.equal(typeof definition.renderResult, "function");
	assert.equal(definition.contractSentinel, true);
}

console.log("read/search presentation factory tests passed");
