import assert from "node:assert/strict";

import {
	BUILTIN_COMPATIBILITY_TOOL_NAMES,
	CLAUDIFY_REGISTERED_TOOL_NAMES,
	COMPATIBILITY_FEATURE_IDS,
	COMPATIBILITY_TOOL_DEFAULT_KEY,
	COMPATIBILITY_TOOL_FAMILIES,
	compatibilityConfigFromSettings,
	compatibilityToolFamilyKey,
	isBuiltinCompatibilityToolName,
	isCompatibilityFeatureId,
	parseCompatibilityConfig,
	resolveCompatibilityFeatureEnabled,
	resolveCompatibilityToolEnabled,
	settingsFeatureEnabled,
	settingsToolEnabled,
	type CompatibilityConfig,
	type CompatibilityFeatureId,
} from "../extensions/domain/compatibility.ts";

// ---------------------------------------------------------------------------
// Registry completeness: the fixed feature ids and registered tools
// tool names are the contract this whole module exists to resolve against.
// ---------------------------------------------------------------------------

const EXPECTED_FEATURE_IDS = [
	"settingsCommand",
	"fullscreenTui",
	"themeColors",
	"assistantMessages",
	"userMessages",
	"customMessages",
	"compactionSummary",
	"toolPresentation",
	"toolBackground",
	"diffPresentation",
	"inspectionGroups",
	"bashStacking",
	"mouseInteraction",
	"spinner",
	"footer",
	"banner",
	"promptPointer",
	"scheduledTasks",
];
assert.deepEqual([...COMPATIBILITY_FEATURE_IDS], EXPECTED_FEATURE_IDS, "the feature ids are fixed and ordered");
assert.equal(COMPATIBILITY_FEATURE_IDS.length, 18, "exactly 18 feature ids");
assert.equal(new Set(COMPATIBILITY_FEATURE_IDS).size, 18, "feature ids are unique");
for (const id of EXPECTED_FEATURE_IDS) assert.ok(isCompatibilityFeatureId(id), `${id} is a recognized feature id`);
assert.equal(isCompatibilityFeatureId("notAFeature"), false);
assert.equal(isCompatibilityFeatureId(42), false);

const EXPECTED_BUILTIN_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls", "apply_patch"];
assert.deepEqual([...BUILTIN_COMPATIBILITY_TOOL_NAMES], EXPECTED_BUILTIN_TOOLS, "the 8 builtin tool names are fixed and ordered");
assert.equal(BUILTIN_COMPATIBILITY_TOOL_NAMES.length, 8, "exactly 8 builtin tool names");
for (const name of EXPECTED_BUILTIN_TOOLS) assert.ok(isBuiltinCompatibilityToolName(name));
assert.equal(isBuiltinCompatibilityToolName("mcp"), false);
assert.deepEqual([...CLAUDIFY_REGISTERED_TOOL_NAMES], [...EXPECTED_BUILTIN_TOOLS, "croncreate", "cronlist", "crondelete"], "every registered tool has a compatibility key");

assert.deepEqual([...COMPATIBILITY_TOOL_FAMILIES], ["mcp", "openai", "generic"]);
assert.equal(compatibilityToolFamilyKey("mcp"), "mcp:*");
assert.equal(compatibilityToolFamilyKey("openai"), "openai:*");
assert.equal(compatibilityToolFamilyKey("generic"), "generic:*");
assert.equal(COMPATIBILITY_TOOL_DEFAULT_KEY, "default");

// ---------------------------------------------------------------------------
// parseCompatibilityConfig: absent/malformed input means "current behavior".
// ---------------------------------------------------------------------------

assert.equal(parseCompatibilityConfig(undefined), undefined, "absent config parses to undefined");
assert.equal(parseCompatibilityConfig(null), undefined);
assert.equal(parseCompatibilityConfig("nonsense"), undefined, "non-object input is dropped, not thrown");
assert.equal(parseCompatibilityConfig(42), undefined);
assert.equal(parseCompatibilityConfig([]), undefined, "arrays are not treated as a config object");
assert.equal(parseCompatibilityConfig({}), undefined, "an empty object has nothing to apply");
assert.equal(parseCompatibilityConfig({ enabled: "false" }), undefined, "a non-boolean enabled is dropped");
assert.equal(parseCompatibilityConfig({ features: { settingsCommand: "off" } }), undefined, "a non-boolean feature value is dropped");
assert.equal(parseCompatibilityConfig({ features: { notAFeature: true } }), undefined, "an unknown feature id is dropped");
assert.equal(parseCompatibilityConfig({ tools: { read: "off" } }), undefined, "a non-boolean tool value is dropped");
assert.equal(parseCompatibilityConfig({ tools: {} }), undefined, "an empty tools object contributes nothing");

assert.deepEqual(parseCompatibilityConfig({ enabled: false }), { enabled: false });
assert.deepEqual(
	parseCompatibilityConfig({ features: { spinner: false, notAFeature: true, banner: "nope" } }),
	{ features: { spinner: false } },
	"malformed sibling entries are dropped, valid ones survive",
);
assert.deepEqual(
	parseCompatibilityConfig({ tools: { Read: false, "mcp:*": true, garbage: "x" } }),
	{ tools: { read: false, "mcp:*": true } },
	"tool keys are lowercased and malformed entries dropped",
);
assert.deepEqual(
	parseCompatibilityConfig({ enabled: true, features: { banner: false }, tools: { bash: false }, extra: "ignored" }),
	{ enabled: true, features: { banner: false }, tools: { bash: false } },
	"unknown top-level keys are ignored without affecting recognized ones",
);

// ---------------------------------------------------------------------------
// resolveCompatibilityFeatureEnabled: table-driven over every feature id.
// ---------------------------------------------------------------------------

for (const id of COMPATIBILITY_FEATURE_IDS) {
	assert.equal(resolveCompatibilityFeatureEnabled(undefined, id), true, `${id}: absent config is enabled`);
	assert.equal(resolveCompatibilityFeatureEnabled({}, id), true, `${id}: empty config is enabled`);
	assert.equal(resolveCompatibilityFeatureEnabled({ enabled: true }, id), true, `${id}: explicit global true is enabled`);
	assert.equal(resolveCompatibilityFeatureEnabled({ features: { [id]: true } }, id), true, `${id}: explicit feature true is enabled`);
	assert.equal(resolveCompatibilityFeatureEnabled({ features: { [id]: false } }, id), false, `${id}: explicit feature false is disabled`);
	assert.equal(resolveCompatibilityFeatureEnabled({ enabled: false }, id), false, `${id}: global false disables it`);
	assert.equal(
		resolveCompatibilityFeatureEnabled({ enabled: false, features: { [id]: true } }, id),
		false,
		`${id}: global false wins even over an explicit feature true`,
	);
	// Every OTHER feature id must stay enabled when only this one is disabled.
	for (const other of COMPATIBILITY_FEATURE_IDS) {
		if (other === id) continue;
		assert.equal(
			resolveCompatibilityFeatureEnabled({ features: { [id]: false } }, other),
			true,
			`${id} disabled does not affect ${other}`,
		);
	}
}

// ---------------------------------------------------------------------------
// resolveCompatibilityToolEnabled: precedence — global, exact name, legacy
// skip, family, default, then true.
// ---------------------------------------------------------------------------

assert.equal(resolveCompatibilityToolEnabled(undefined, "read"), true, "absent config: enabled");
assert.equal(resolveCompatibilityToolEnabled({}, "read"), true, "empty config: enabled");
assert.equal(resolveCompatibilityToolEnabled({ enabled: false }, "read"), false, "global false disables every tool");
assert.equal(resolveCompatibilityToolEnabled({ enabled: false }, "read", "mcp", false), false, "global false wins over family too");
assert.equal(
	resolveCompatibilityToolEnabled({ enabled: false, tools: { read: true } }, "read"),
	false,
	"global false wins even over an exact tool-name true",
);

// Exact name wins over legacy skip, family, and default.
for (const name of BUILTIN_COMPATIBILITY_TOOL_NAMES) {
	assert.equal(resolveCompatibilityToolEnabled({ tools: { [name]: true } }, name, undefined, true), true, `${name}: exact true beats legacy skip`);
	assert.equal(resolveCompatibilityToolEnabled({ tools: { [name]: false } }, name, undefined, false), false, `${name}: exact false disables`);
	assert.equal(
		resolveCompatibilityToolEnabled({ tools: { [name]: true, default: false } }, name, undefined, false),
		true,
		`${name}: exact true beats a false default`,
	);
}
// Case-insensitive exact match.
assert.equal(resolveCompatibilityToolEnabled({ tools: { read: false } }, "Read"), false, "tool name matching is case-insensitive");
assert.equal(resolveCompatibilityToolEnabled({ tools: { READ: false } }, "read"), true, "config keys are not case-folded by the resolver itself (parse does that)");

// Legacy skipToolOverrides acts as an exact-false override, subordinate to an explicit exact entry.
assert.equal(resolveCompatibilityToolEnabled({}, "grep", undefined, true), false, "legacy skip disables with no compatibility.tools at all");
assert.equal(resolveCompatibilityToolEnabled({ tools: { grep: true } }, "grep", undefined, true), true, "an explicit exact true overrides legacy skip");
assert.equal(resolveCompatibilityToolEnabled({ tools: { default: true } }, "grep", undefined, true), false, "legacy skip wins over a permissive default");
assert.equal(resolveCompatibilityToolEnabled({ tools: { "generic:*": true } }, "grep", "generic", true), false, "legacy skip wins over a permissive family");

// Family resolution for dynamic (non-builtin) tools.
for (const family of COMPATIBILITY_TOOL_FAMILIES) {
	const key = compatibilityToolFamilyKey(family);
	assert.equal(resolveCompatibilityToolEnabled({ tools: { [key]: false } }, "some_tool", family), false, `${key}: family false disables`);
	assert.equal(resolveCompatibilityToolEnabled({ tools: { [key]: true } }, "some_tool", family), true, `${key}: family true enables`);
	assert.equal(
		resolveCompatibilityToolEnabled({ tools: { [key]: false, some_tool: true } }, "some_tool", family),
		true,
		`${key}: an exact name still beats its own family`,
	);
	// A different family's entry must not leak.
	const otherFamily = COMPATIBILITY_TOOL_FAMILIES.find((candidate) => candidate !== family)!;
	assert.equal(
		resolveCompatibilityToolEnabled({ tools: { [compatibilityToolFamilyKey(otherFamily)]: false } }, "some_tool", family),
		true,
		`${key}: a sibling family's false does not affect ${family}`,
	);
}

// default is consulted after family, before the true fallback.
assert.equal(resolveCompatibilityToolEnabled({ tools: { default: false } }, "anything", "generic"), false);
assert.equal(resolveCompatibilityToolEnabled({ tools: { "generic:*": true, default: false } }, "anything", "generic"), true, "family beats default");
assert.equal(resolveCompatibilityToolEnabled({ tools: {} }, "anything", "generic"), true, "no matching entry at all falls back to true");

// ---------------------------------------------------------------------------
// Settings-shaped convenience wrappers.
// ---------------------------------------------------------------------------

assert.equal(compatibilityConfigFromSettings(undefined), undefined);
assert.equal(compatibilityConfigFromSettings({}), undefined);
assert.deepEqual(compatibilityConfigFromSettings({ compatibility: { enabled: false } }), { enabled: false });

assert.equal(settingsFeatureEnabled(undefined, "banner"), true);
assert.equal(settingsFeatureEnabled({ compatibility: { enabled: false } }, "banner"), false);
assert.equal(settingsFeatureEnabled({ compatibility: { features: { banner: false } } }, "banner"), false);
assert.equal(settingsFeatureEnabled({ compatibility: { features: { banner: false } } }, "footer"), true);

assert.equal(settingsToolEnabled(undefined, "bash"), true);
assert.equal(settingsToolEnabled({ compatibility: { tools: { bash: false } } }, "bash"), false);
assert.equal(settingsToolEnabled({ skipToolOverrides: ["bash"] }, "bash", undefined, true), false, "caller-supplied legacySkipped flag is honored");
assert.equal(settingsToolEnabled({ compatibility: { tools: { "mcp:*": false } } }, "plane_list_work_items", "mcp"), false);

console.log("compatibility control domain tests passed");
