import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const initialSandbox = mkdtempSync(join(tmpdir(), "cc-settings-initial-"));
process.env.HOME = join(initialSandbox, "home");
process.chdir(join(initialSandbox));

const { readSettings } = await import("../extensions/settings.ts");

function useSandbox(
	user: Record<string, unknown> | string | null,
	project: Record<string, unknown> | string | null,
) {
	const sandbox = mkdtempSync(join(tmpdir(), "cc-settings-"));
	const home = join(sandbox, "home");
	const cwd = join(sandbox, "project");
	mkdirSync(join(home, ".pi"), { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	const serialize = (v: Record<string, unknown> | string) => (typeof v === "string" ? v : JSON.stringify(v));
	if (user !== null) writeFileSync(join(home, ".pi", "settings.json"), serialize(user));
	if (project !== null) writeFileSync(join(cwd, ".pi", "settings.json"), serialize(project));
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

const statuses = useSandbox({ spinnerColor: "user-color" }, {});
assert.equal(statuses.files.user.status, "ok");
assert.equal(statuses.files.project.status, "ok");
assert.ok(statuses.files.user.path.endsWith("/.pi/settings.json"));

const brokenProject = useSandbox({ spinnerColor: "user-color" }, "{ not json");
assert.equal(brokenProject.files.project.status, "invalid", "a malformed project file is reported, not treated as missing");
assert.equal(brokenProject.files.user.status, "ok");
assert.equal(brokenProject.values.spinnerColor, "user-color", "user values survive a malformed project file");
assert.equal(brokenProject.sources.spinnerColor, "user");

const arrayProject = useSandbox({}, '["spinnerColor", "red"]');
assert.equal(arrayProject.files.project.status, "invalid", "non-object top-level JSON is invalid, not silently empty");

const missingProject = useSandbox({ spinnerColor: "user-color" }, null);
assert.equal(missingProject.files.project.status, "missing");
assert.equal(missingProject.values.spinnerColor, "user-color");

const refreshSandbox = mkdtempSync(join(tmpdir(), "cc-settings-refresh-"));
const refreshHome = join(refreshSandbox, "home");
const refreshCwd = join(refreshSandbox, "project");
mkdirSync(join(refreshHome, ".pi"), { recursive: true });
mkdirSync(join(refreshCwd, ".pi"), { recursive: true });
const refreshPath = join(refreshCwd, ".pi", "settings.json");
writeFileSync(refreshPath, JSON.stringify({ spinnerColor: "before" }));
process.env.HOME = refreshHome;
process.chdir(refreshCwd);
assert.equal(readSettings().values.spinnerColor, "before");
writeFileSync(refreshPath, JSON.stringify({ spinnerColor: "after" }));
const realDateNow = Date.now;
Date.now = () => realDateNow() + 1_001;
try {
	assert.equal(readSettings().values.spinnerColor, "after", "same-path edits refresh after the spinner cache window");
} finally {
	Date.now = realDateNow;
}

console.log("settings reader tests passed");
