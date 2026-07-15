import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const initialSandbox = mkdtempSync(join(tmpdir(), "cc-settings-initial-"));
process.env.HOME = join(initialSandbox, "home");
process.chdir(join(initialSandbox));

const { readSettings } = await import("../extensions/settings.ts");

function useSandbox(user: Record<string, unknown>, project: Record<string, unknown>) {
	const sandbox = mkdtempSync(join(tmpdir(), "cc-settings-"));
	const home = join(sandbox, "home");
	const cwd = join(sandbox, "project");
	mkdirSync(join(home, ".pi"), { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(home, ".pi", "settings.json"), JSON.stringify(user));
	writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(project));
	process.env.HOME = home;
	process.chdir(cwd);
	return readSettings();
}

const merged = useSandbox(
	{
		spinnerColor: "user-color",
		spinnerStatusColor: "user-status",
	},
	{
		spinnerColor: "project-color",
	},
);
assert.equal(merged.values.spinnerColor, "project-color", "project values override user values per key");
assert.equal(merged.sources.spinnerColor, "project");
assert.equal(merged.values.spinnerStatusColor, "user-status", "user values survive when the project omits the key");
assert.equal(merged.sources.spinnerStatusColor, "user");

const legacy = useSandbox(
	{
		spinnerVerbColor: "legacy-color",
		toolBackground: "border",
	},
	{},
);
assert.equal(legacy.values.spinnerColor, "legacy-color", "spinnerVerbColor remains an alias for spinnerColor");
assert.equal(legacy.sources.spinnerColor, "user");
assert.equal(legacy.values.toolBackground, "outlines", 'toolBackground: "border" remains an alias for "outlines"');
assert.equal(legacy.sources.toolBackground, "user");

const projectLegacy = useSandbox(
	{ spinnerColor: "user-canonical" },
	{ spinnerVerbColor: "project-legacy" },
);
assert.equal(projectLegacy.values.spinnerColor, "project-legacy", "a project legacy alias overrides a user canonical value");
assert.equal(projectLegacy.sources.spinnerColor, "project");

const canonical = useSandbox(
	{
		spinnerColor: "user-canonical",
		spinnerVerbColor: "user-legacy",
	},
	{
		spinnerColor: "project-canonical",
		spinnerVerbColor: "project-legacy",
	},
);
assert.equal(canonical.values.spinnerColor, "project-canonical", "canonical keys win over aliases in the winning file");
assert.equal(canonical.sources.spinnerColor, "project");

const isolated = useSandbox(
	{
		diffColors: { added: "green" },
	},
	{},
);
isolated.values.diffColors!.added = "changed";
isolated.sources.diffColors = "project";
const reread = readSettings();
assert.equal(reread.values.diffColors!.added, "green", "callers cannot mutate cached settings values");
assert.equal(reread.sources.diffColors, "user", "callers cannot mutate cached provenance");

console.log("settings reader tests passed");
