import {
	COMPATIBILITY_FEATURE_IDS,
	resolveCompatibilityFeatureEnabled,
	type CompatibilityConfig,
	type CompatibilityFeatureId,
} from "../domain/compatibility.ts";
import type { ActivationPlan, CapabilityId, FeatureDecision, HostDescriptor } from "./contracts.ts";

const TESTED_PRESENTATION: readonly CapabilityId[] = ["tested:component-renderers"];

const FEATURE_REQUIREMENTS: Readonly<Record<CompatibilityFeatureId, readonly CapabilityId[]>> = {
	settingsCommand: ["tested:message-renderers"],
	fullscreenTui: ["tested:container-composition"],
	themeColors: ["tested:message-renderers"],
	assistantMessages: ["tested:message-renderers"],
	userMessages: ["tested:message-renderers"],
	customMessages: ["tested:message-renderers"],
	compactionSummary: ["tested:message-renderers"],
	toolPresentation: TESTED_PRESENTATION,
	toolBackground: TESTED_PRESENTATION,
	diffPresentation: TESTED_PRESENTATION,
	inspectionGroups: ["tested:container-composition"],
	bashStacking: ["tested:container-composition"],
	mouseInteraction: ["tested:mouse-layout"],
	spinner: ["tested:spinner-loader"],
	footer: ["tested:message-renderers"],
	banner: ["tested:message-renderers"],
	promptPointer: ["tested:message-renderers"],
	scheduledTasks: ["public:events", "public:tools", "public:send-user-message"],
	askUserQuestion: ["public:tools", "public:tui"],
	taskPresentation: ["tested:component-renderers", "tested:task-widget"],
};

export function buildActivationPlan(host: HostDescriptor, compatibility: CompatibilityConfig | undefined): ActivationPlan {
	const decisions = new Map<CompatibilityFeatureId, FeatureDecision>();
	for (const id of COMPATIBILITY_FEATURE_IDS) {
		if (!resolveCompatibilityFeatureEnabled(compatibility, id)) {
			decisions.set(id, Object.freeze({ enabled: false, reason: "user-disabled", missingCapabilities: [] }));
			continue;
		}
		const missing = FEATURE_REQUIREMENTS[id].filter((capability) => !host.capabilities.has(capability));
		decisions.set(id, Object.freeze({
			enabled: missing.length === 0,
			reason: missing.length === 0 ? "default" : "missing-capability",
			missingCapabilities: Object.freeze(missing),
		}));
	}
	const readonlyDecisions: ReadonlyMap<CompatibilityFeatureId, FeatureDecision> = decisions;
	return Object.freeze({
		host,
		features: readonlyDecisions,
		featureEnabled: (id: CompatibilityFeatureId) => readonlyDecisions.get(id)?.enabled === true,
		featureDecision: (id: CompatibilityFeatureId) => readonlyDecisions.get(id) ?? Object.freeze({ enabled: false, reason: "profile-disabled", missingCapabilities: [] }),
	});
}
