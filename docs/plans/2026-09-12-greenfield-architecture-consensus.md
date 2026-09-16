# Greenfield Architecture Consensus

Date: 2026-09-12
Inputs: three independent blind architecture proposals over the sanitized round-three candidate.

## Decision

Do not perform a big-bang rewrite. Preserve behavior with a strangler migration that separates pure policy from host compatibility and reduces `extensions/index.ts` to a composition root.

## Dependency direction

```text
domain/contracts → rendering → host adapters → composition root
```

Only host adapters may touch Pi private fields, prototypes, module identity, `Symbol.for`, or structural compatibility probes.

## Target layout

```text
extensions/
  extension.ts
  domain/
    tools/
    diff/
    inspection/
    palette/
  terminal/
    text-types.ts
    metadata-sanitizer.ts
    content-sanitizer.ts
    command-audit-codec.ts
  render/
    tool-rows/
    diff/
    chrome/
  host/
    capabilities.ts
    patch-registry.ts
    tool-execution-adapter.ts
    container-adapter.ts
    theme-bridge.ts
    reload-state.ts
  lifecycle/
    runtime.ts
    epochs.ts
    disposal.ts
  settings/
    schema.ts
    aliases.ts
    store.ts
    effective-profile.ts
  transcript/
    inspection-policy.ts
    inspection-group.ts
    reconciliation.ts
    expansion-coordinator.ts
    mouse-layout.ts
  ui/
    banner-controller.ts
    prompt-editor.ts
    footer-controller.ts
    settings-screen.ts
    fullscreen-tui.ts
```

Target: `extension.ts` under roughly 300 lines.

## Core contracts

- `ToolCallView` and `ToolResultView` are discriminated unions built once at the host boundary.
- `ToolPresentationAdapter` validates observable call/result shape and owns rendering only.
- `ExecutionOwner` is `builtin | self | external | unknown`; unknown always preserves native execution.
- `RuntimeHandle` owns settings, transcript, and diff epochs plus one disposal stack.
- Terminal strings use nominal types: metadata, multiline content, reversible command audit text, and trusted ANSI.
- Renderers accept data, width, and palette and return rows; they do not read host state.

## State machines

Explicit state machines replace scattered booleans for:

1. tool execution: pending → streaming → settled → expanded;
2. inspection grouping: ungrouped → candidate → collapsed/active → expanded/native fallback;
3. async rendering: idle → building → ready/discarded, with one active and one latest queued request;
4. patch ownership: unpatched → stable shim → active generation → owner-checked release;
5. picker settings: committed → previewing → committed/cancelled.

## Preserve from the current implementation

- `DiffCardComponent` generation/width/epoch scheduling and bounded cache;
- plan-before-commit inspection reconciliation;
- exact bounded visual-row accounting;
- queue-owned edit provenance;
- distinct terminal text policies;
- execution/presentation ownership separation;
- capture-backed Claude semantic palettes;
- owner-token lifecycle delegates.

## Delete or consolidate

- duplicate patch-registry implementations;
- rendering logic embedded in the extension entry point;
- duplicate generic/OpenAI result formatting;
- process-lifetime MCP discovery maps without lifecycle bounds;
- rendered-glyph Markdown inference;
- ad hoc theme identity handling outside one bridge;
- any filesystem reconstruction of settled edit provenance.

## Required Pi-core APIs

The ideal implementation requires:

1. `registerToolPresentation(name, adapter)` independent of tool execution;
2. stable public tool ownership metadata;
3. transcript/row composition or decoration hooks;
4. a public `ToolExecutionRow` presentation interface;
5. stable theme identity;
6. explicit extension-generation/reload lifecycle;
7. effective host tool settings capability;
8. canonical host-module resolution for packed topologies.

Until those exist, compatibility shims stay isolated in `host/` and must degrade to native behavior when uncertain.

## Test pyramid

1. Pure contract/domain tests.
2. Width-matrixed render golden tests tied to capture IDs.
3. Host-adapter contract/drift canaries against each supported Pi version.
4. Fake-host integration tests for wiring and settings epochs.
5. Minimal real PTY tests for mouse, reload, and terminal ANSI behavior.
6. Deliberately split packed-module topology tests.
7. Property-based terminal-sanitizer tests.

## Migration sequence

1. Add dependency-boundary enforcement, exempting current `index.ts`.
2. Extract `RuntimeHandle`, disposal, and three epochs.
3. Extract pure palette math and diff parsing/summary.
4. Move builtin presenters one at a time, starting with grep/find/ls.
5. Extract ownership and tool compatibility into the host adapter.
6. Replace bespoke prototype registries with one `PatchRegistry<T>`.
7. Introduce discriminated tool call/result views.
8. Split sanitizer policies and add nominal text types.
9. Consolidate generic/OpenAI renderers and lifecycle-bound MCP caches.
10. Reduce the entry point to capability probing, registration, and controller wiring.
11. Delete each compatibility shim as the corresponding Pi API lands.

Every stage must preserve the multi-version suite, packed consumer, strict TypeScript, and real PTY gates.
