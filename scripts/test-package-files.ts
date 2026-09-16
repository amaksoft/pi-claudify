import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DEFAULT_DIFF_COLLAPSED_LINES } from "../extensions/settings.ts";

const root = process.cwd();
function files(path: string): string[] {
	return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
		const child = join(path, entry.name);
		return entry.isDirectory() ? files(child) : entry.name.endsWith(".ts") ? [relative(root, child).replaceAll("\\", "/")] : [];
	});
}
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const declared = (manifest.files as string[]).filter((path) => path.startsWith("extensions/") && path.endsWith(".ts")).sort();
const actual = files(join(root, "extensions")).sort();
assert.deepEqual(declared, actual, "package.json files includes every runtime TypeScript module exactly once");
const exampleConfig = JSON.parse(readFileSync(join(root, "config", "config.example.json"), "utf8"));
assert.equal(exampleConfig.diffCollapsedLines, DEFAULT_DIFF_COLLAPSED_LINES, "example config matches the runtime/UI collapsed Write diff default");
console.log("package files whitelist tests passed");
