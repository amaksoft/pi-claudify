// Wiring: composes candidate classification + render policy into the
// InspectionGroupPolicy the host-facing reconciler consumes, and re-exports
// the pieces index.ts needs to build one InspectionGroupRuntime per call.

import { markPointerExpandedMembers } from "../expansion-coordinator.ts";
import { reconcileInspectionGroups, type InspectionGroupPolicy } from "../inspection-group.ts";
import { isSettledToolExecution, setToolExpanded } from "../pi-tool-adapter.ts";
import { isInspectionGroupCandidate } from "./inspection-candidates.ts";
import { renderActiveInspectionGroup, renderSettledInspectionGroup } from "./inspection-render.ts";
import type { InspectionGroupRuntime } from "./runtime.ts";

export type { InspectionGroupRuntime, ToolBackgroundMode } from "./runtime.ts";
export {
	inspectionKind,
	isInspectionGroupCandidate,
	isMcpToolExecution,
	mcpServersInGroup,
	readOnlyToolGroupingEnabled,
	readOnlyToolGroupLimit,
	shellGroupingEnabled,
} from "./inspection-candidates.ts";
export { fitInspectionLine, frameInspectionLines, renderActiveInspectionGroup, renderSettledInspectionGroup } from "./inspection-render.ts";

/**
 * A tool is settled once it has a NON-partial result.
 *
 * pi assigns `.result` when execution STARTS and streams into it with
 * `isPartial === true` (replacing the object per update); completion flips
 * `isPartial` to false, and restored history rows are already false. So
 * result-presence alone reads "settled" for the entire run, which collapsed the
 * aggregate a frame after it appeared and made the active "Running…" header
 * effectively unreachable.
 * Capture: docs/plans/2026-09-07-inspection-group-interaction.md
 */
export const isSettledInspectionTool = isSettledToolExecution;

/** Builds the policy fresh per call so it always closes over the current runtime. */
export function createInspectionGroupPolicy(runtime: InspectionGroupRuntime): InspectionGroupPolicy {
	return {
		isEligible: (value) => isInspectionGroupCandidate(value, runtime.isPresentationOverrideSkipped),
		isSettled: isSettledInspectionTool,
		setExpanded: setToolExpanded,
		onPointerExpand: markPointerExpandedMembers,
		renderActive: (group, width) => renderActiveInspectionGroup(group, width, runtime),
		renderSettled: (group, width) => renderSettledInspectionGroup(group, width, runtime),
	};
}

export function ensureInspectionGroups(container: unknown, runtime: InspectionGroupRuntime): void {
	reconcileInspectionGroups(container, createInspectionGroupPolicy(runtime));
}
