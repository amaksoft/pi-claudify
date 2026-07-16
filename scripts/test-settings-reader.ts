import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const initialSandbox = mkdtempSync(join(tmpdir(), "cc-settings-initial-"));
process.env.HOME = join(initialSandbox, "home");
process.chdir(join(initialSandbox));

const { readSettings, writeSettingsKey } = await import("../extensions/settings.ts");

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

const userOnly = useSandbox(
	{
		spinnerStatusColor: "user-status",
	},
	{
		spinnerColor: "project-color",
	},
);
assert.equal(userOnly.values.spinnerColor, undefined, "project settings have no effect");
assert.equal(userOnly.values.spinnerStatusColor, "user-status");
assert.deepEqual(Object.keys(userOnly).sort(), ["file", "values"], "the snapshot describes only the user file");
assert.equal(userOnly.file.status, "ok");
assert.ok(userOnly.file.path.endsWith("/home/.pi/settings.json"));

const legacy = useSandbox(
	{
		spinnerVerbColor: "legacy-color",
		toolBackground: "border",
	},
	{},
);
assert.equal(legacy.values.spinnerColor, "legacy-color", "spinnerVerbColor remains an alias for spinnerColor");
assert.equal(legacy.values.toolBackground, "outlines", 'toolBackground: "border" remains an alias for "outlines"');

const canonical = useSandbox(
	{
		spinnerColor: "user-canonical",
		spinnerVerbColor: "user-legacy",
	},
	{},
);
assert.equal(canonical.values.spinnerColor, "user-canonical", "canonical keys win over aliases in the user file");

const isolated = useSandbox(
	{
		diffColors: { added: "green" },
	},
	{},
);
isolated.values.diffColors!.added = "changed";
const reread = readSettings();
assert.equal(reread.values.diffColors!.added, "green", "callers cannot mutate cached settings values");

const brokenUser = useSandbox("{ not json", { spinnerColor: "project-color" });
assert.equal(brokenUser.file.status, "invalid", "a malformed user file is reported, not treated as missing");
assert.deepEqual(brokenUser.values, {}, "a malformed user file contributes no values");
assert.deepEqual(writeSettingsKey("previewLines", 12), { success: true, backupCreated: true }, "a successful recovery reports both the save and backup");
assert.equal(readFileSync(`${brokenUser.file.path}.bak`, "utf8"), "{ not json", "writing backs up an unparseable user file");
assert.deepEqual(JSON.parse(readFileSync(brokenUser.file.path, "utf8")), { previewLines: 12 }, "writing replaces an unparseable file only after backup succeeds");

const brokenBackup = useSandbox("{ still broken", {});
mkdirSync(`${brokenBackup.file.path}.bak`);
assert.deepEqual(writeSettingsKey("previewLines", 12), { success: false, backupCreated: false }, "a failed backup reports that the setting was not saved or backed up");
assert.equal(readFileSync(brokenBackup.file.path, "utf8"), "{ still broken", "a failed backup leaves the invalid settings file intact");

const brokenWriteFailure = useSandbox("{ backup then fail", {});
mkdirSync(`${brokenWriteFailure.file.path}.tmp`);
assert.deepEqual(writeSettingsKey("previewLines", 12), { success: false, backupCreated: true }, "a write failure still reports a backup that completed first");
assert.equal(readFileSync(`${brokenWriteFailure.file.path}.bak`, "utf8"), "{ backup then fail");
assert.equal(readFileSync(brokenWriteFailure.file.path, "utf8"), "{ backup then fail", "a post-backup write failure leaves the invalid settings file intact");

const arrayUser = useSandbox('["spinnerColor", "red"]', {});
assert.equal(arrayUser.file.status, "invalid", "non-object top-level JSON is invalid, not silently empty");
assert.deepEqual(writeSettingsKey("previewLines", 12), { success: true, backupCreated: true }, "a non-object settings file is recoverable like malformed JSON");
assert.equal(readFileSync(`${arrayUser.file.path}.bak`, "utf8"), '["spinnerColor", "red"]');
assert.deepEqual(JSON.parse(readFileSync(arrayUser.file.path, "utf8")), { previewLines: 12 });

const writeFailure = useSandbox({ spinnerColor: "before" }, {});
mkdirSync(`${writeFailure.file.path}.tmp`);
assert.deepEqual(writeSettingsKey("spinnerColor", "after"), { success: false, backupCreated: false }, "an atomic write failure reports that the setting was not saved");
assert.deepEqual(JSON.parse(readFileSync(writeFailure.file.path, "utf8")), { spinnerColor: "before" }, "an atomic write failure leaves healthy settings intact");

const missingUser = useSandbox(null, { spinnerColor: "project-color" });
assert.equal(missingUser.file.status, "missing");
assert.deepEqual(missingUser.values, {}, "project settings do not fill in for a missing user file");

const refreshSandbox = mkdtempSync(join(tmpdir(), "cc-settings-refresh-"));
const refreshHome = join(refreshSandbox, "home");
const refreshCwd = join(refreshSandbox, "project");
mkdirSync(join(refreshHome, ".pi"), { recursive: true });
mkdirSync(join(refreshCwd, ".pi"), { recursive: true });
const refreshPath = join(refreshHome, ".pi", "settings.json");
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

const previousHome = process.env.HOME;
process.env.HOME = "";
try {
	assert.deepEqual(writeSettingsKey("previewLines", 12), { success: false, backupCreated: false }, "an empty HOME reports that the setting was not saved");
} finally {
	process.env.HOME = previousHome;
}

console.log("settings reader tests passed");
