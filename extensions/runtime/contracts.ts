import type { CompatibilityFeatureId } from "../domain/compatibility.ts";

export type ClaudifyProfile = "portable" | "tested-pi" | "certified-host";
export type ClaudifyProfilePreference = "auto" | ClaudifyProfile | "legacy";

export type CapabilityId =
	| "public:commands"
	| "public:events"
	| "public:tools"
	| "public:send-user-message"
	| "public:tui"
	| "tested:component-renderers"
	| "tested:container-composition"
	| "tested:message-renderers"
	| "tested:mouse-layout"
	| "tested:spinner-loader"
	| "tested:task-widget";

export interface HostDescriptor {
	readonly id: string;
	readonly profile: ClaudifyProfile;
	readonly piVersion?: string;
	readonly environment: "npm" | "meta" | "other";
	readonly capabilities: ReadonlySet<CapabilityId>;
	readonly selectionReason: string;
}

export type FeatureDecisionReason =
	| "default"
	| "user-disabled"
	| "profile-disabled"
	| "missing-capability"
	| "probe-failed";

export interface FeatureDecision {
	readonly enabled: boolean;
	readonly reason: FeatureDecisionReason;
	readonly missingCapabilities: readonly CapabilityId[];
}

export interface ActivationPlan {
	readonly host: HostDescriptor;
	readonly features: ReadonlyMap<CompatibilityFeatureId, FeatureDecision>;
	featureEnabled(id: CompatibilityFeatureId): boolean;
	featureDecision(id: CompatibilityFeatureId): FeatureDecision;
}

export interface Disposable {
	dispose(): void | Promise<void>;
}

export type DisposeCallback = () => void | Promise<void>;
