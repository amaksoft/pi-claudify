# Pi APIs that would retire Claudify compatibility hooks

Claudify does not require these APIs to ship. Its tested-Pi adapter implements the same internal ports through capability-probed compatibility hooks. Each upstream API can replace one adapter surface independently.

## 1. Presentation-only tool decoration

```ts
interface ToolPresentationHandle { dispose(): void }

pi.decorateTool(
  selector: { name: string; owner?: "builtin" | string },
  presentation: {
    renderCall?: ToolDefinition["renderCall"];
    renderResult?: ToolDefinition["renderResult"];
    renderShell?: "default" | "self";
  },
): ToolPresentationHandle;
```

Requirements:

- never changes schema, execute, prompt metadata, trust, sandboxing, cancellation, or source ownership;
- deterministic extension ordering;
- generation-scoped disposal;
- applies to live and restored rows;
- exposes the actual execution owner to the decorator;
- supports explicit abstention/fallback per call and result.

This replaces Claudify's `ToolExecutionComponent` renderer trampoline and removes the historical need to re-register native tools.

## 2. Transcript projection/composition

```ts
interface TranscriptRow {
  id: string;
  kind: string;
  owner: SourceInfo;
  semanticRevision: number;
}

pi.decorateTranscript(
  selector: (row: TranscriptRow) => boolean,
  compose: (rows: readonly TranscriptRow[], context: LayoutContext) => LayoutResult | undefined,
): Disposable;

interface LayoutResult {
  lines: readonly string[];
  hitRegions: readonly HitRegion[];
  sourceRowIds: readonly string[];
}
```

Requirements:

- stable row IDs across restoration and resize;
- explicit zero-height/decorative rows versus semantic barriers;
- atomic lines and hit geometry;
- native fallback when a composer abstains or throws;
- no mutation/reparenting of host component arrays;
- composable ordering when several extensions decorate transcript rows.

This replaces `Container.prototype.render` patching, wrapper reconstruction, private mouse-layout writes, and inferred zero-height separators.

## 3. Scoped registration and lifecycle

```ts
interface ExtensionGenerationContext {
  generationId: string;
  sessionId: string;
  parentSessionId?: string;
  signal: AbortSignal;
  onDispose(callback: () => void | Promise<void>): void;
}

pi.registerTool(definition, { mode: "replace" | "fallback" }): Disposable;
pi.registerCommand(name, command): Disposable;
```

Requirements:

- `fallback` registers only when no owner exists and never displaces a later owner silently;
- registration handles are exact-owner and idempotently disposable;
- documented ordering for startup, nested AgentSessions, reload, replacement, fork, and shutdown;
- old-generation callbacks are fenced when disposal begins;
- `getAllTools()` is explicitly unavailable during factory loading or replaced with a factory-safe registry view.

This replaces ownership snapshots, absent-versus-unknown inference, owner stacks, and timed generation release.

## 4. Complete branch revision notification

```ts
pi.on("branch_revision", ({ sessionId, branchId, leafId, revision, reason }) => {});
```

It must cover every mutation that can affect visible history, including extension `appendEntry`, labels, model/thinking changes, compaction, tree navigation, restore, and replacement. A snapshot API should return the matching revision atomically.

This allows persistent branch-derived presentation without stale widgets or callback-order assumptions.

## 5. Public working and theme surfaces

Useful smaller APIs:

- generation-scoped working-indicator renderer;
- stable theme identity/revision;
- public physical-row background/framing hooks;
- exact terminal width/grapheme and hit-region helpers shared with the host;
- public settled/partial/expanded tool-row state.

These retire Loader, Theme, and private component-layout patches without changing Claudify's domain or rendering layers.

## Conformance fixtures

Each proposed API should ship with host tests for:

- parent plus overlapping child sessions;
- non-LIFO child teardown;
- reload while a child remains active;
- extension removal during reload;
- external same-name tool ownership;
- restored history and terminal resize;
- handler failure and partial registration;
- exact disposal and bounded listener/resource counts.
