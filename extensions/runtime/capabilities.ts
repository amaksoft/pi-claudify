import type { CapabilityId, ClaudifyProfile, ClaudifyProfilePreference, HostDescriptor } from "./contracts.ts";

export const TESTED_PI_VERSIONS = ["0.74.0", "0.80.6", "0.85.1"] as const;

const PUBLIC_CAPABILITIES: readonly CapabilityId[] = [
	"public:commands",
	"public:events",
	"public:tools",
	"public:send-user-message",
	"public:tui",
];

const TESTED_CAPABILITIES: readonly CapabilityId[] = [
	...PUBLIC_CAPABILITIES,
	"tested:component-renderers",
	"tested:container-composition",
	"tested:message-renderers",
	"tested:mouse-layout",
	"tested:spinner-loader",
];

export function parseProfilePreference(value: unknown): ClaudifyProfilePreference {
	const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (normalized === "portable" || normalized === "tested-pi" || normalized === "certified-host" || normalized === "legacy") return normalized;
	return "auto";
}

export interface HostDetectionInput {
	piVersion?: string;
	profilePreference?: ClaudifyProfilePreference;
	environment?: HostDescriptor["environment"];
	/** Migration default. Set false once portable mode has full public-surface coverage. */
	preserveCurrentBehavior?: boolean;
	observedCapabilities?: ReadonlySet<CapabilityId>;
}

export function detectHostDescriptor(input: HostDetectionInput = {}): HostDescriptor {
	const preference = input.profilePreference ?? "auto";
	const environment = input.environment ?? "npm";
	const exactTested = !!input.piVersion && (TESTED_PI_VERSIONS as readonly string[]).includes(input.piVersion);
	let profile: ClaudifyProfile;
	let selectionReason: string;

	if (preference === "portable") {
		profile = "portable";
		selectionReason = "forced-portable";
	} else if (preference === "certified-host") {
		// No certified-host adapter exists yet. Fail to the public profile rather
		// than silently granting capabilities that the host did not prove.
		profile = "portable";
		selectionReason = "certified-host-unavailable";
	} else if (preference === "tested-pi" || preference === "legacy") {
		profile = "tested-pi";
		selectionReason = preference === "legacy" ? "forced-legacy" : "forced-tested-pi";
	} else if (exactTested) {
		profile = "tested-pi";
		selectionReason = "exact-tested-version";
	} else if (input.preserveCurrentBehavior !== false) {
		// Transitional behavior: until the portable adapter exposes all safe
		// public surfaces, auto keeps the already-supported path. Structural
		// probes in the tested adapter remain authoritative for each feature.
		profile = "tested-pi";
		selectionReason = "migration-default";
	} else {
		profile = "portable";
		selectionReason = "unrecognized-host";
	}

	return Object.freeze({
		id: `${environment}:${input.piVersion ?? "unknown"}:${profile}`,
		profile,
		piVersion: input.piVersion,
		environment,
		capabilities: new Set(profile === "tested-pi" ? input.observedCapabilities ?? TESTED_CAPABILITIES : PUBLIC_CAPABILITIES),
		selectionReason,
	});
}
