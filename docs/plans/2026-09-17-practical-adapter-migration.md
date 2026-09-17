# Practical runtime and adapter migration

## Decision

Claudify will evolve incrementally behind three capability profiles rather than wait for upstream Pi APIs or perform a big-bang rewrite.

1. **Portable** uses documented Pi APIs and fails native when a complete implementation is unavailable.
2. **Tested Pi** is the default on validated Pi and Meta builds and contains the compatibility hooks required for the complete Claude-like experience.
3. **Certified host** is reserved for future public host contracts. No speculative durable kernel or deployment protocol will be implemented before those contracts exist.

The current implementation remains the behavioral oracle until each replacement passes equivalent real-host tests.

## Non-negotiable invariants

- Pi or the pre-existing extension owns execution for existing tools.
- Claudify-owned tools are additive and collision-safe.
- Unknown ownership and unknown host shapes fail native.
- Every feature is enabled by default on a supported host and has a surgical kill switch.
- Every extension factory invocation has one generation owner and abort signal.
- Nested sessions cannot replace or release their parent's host bindings.
- A retiring reload generation is only a gap fallback; its successor wins immediately.
- Historical and live presentation derive from the same semantic model.
- Rendered rows and interaction geometry come from the same layout result.
- Retained maps, caches, timers, listeners, and provenance are bounded.

## Target boundaries

```text
runtime/                         profile selection, activation plan, generation handle
adapters/public-pi.ts            documented public APIs only
adapters/tested-pi/              probes, stable patch broker, compatibility ports
adapters/certified-host/         future public host implementation only
domain/                          pure semantic policy
render/                          pure width/theme-aware rendering
transcript/                      semantic extraction, grouping, projection
tools/presentations/             call/result presentation without execute/schema
tools/cron-tools.ts              additive execution owned by Claudify
tools/ask-user-question.ts       additive execution owned by Claudify
index.ts                         thin composition root
```

Only the tested-Pi adapter may inspect private host components or patch prototypes. Imports must not install patches, start timers, or register resources.

## Migration phases

### 0. Characterize

Inventory every global symbol, patch, timer, listener, registration, and entry point. Add tests for portable no-op behavior, resource bounds, nested ownership, repeated reload, tool identity, and package topology.

### 1. Establish runtime boundaries

Add immutable capability/profile resolution, `ActivationPlan`, and `RuntimeHandle`. Wrap the current implementation as the tested-Pi adapter. Add `PI_CLAUDIFY_PROFILE=portable|tested-pi|legacy`; `auto` preserves current behavior during migration.

### 2. Extract presentation definitions

For Read/Search, Bash, Edit/Write, and generic/MCP tools, split `renderCall`/`renderResult` from executable definitions. Preserve behavior by composing the old overrides from the new presentation definitions. Require shadow parity tests.

### 3. Centralize host patches

Replace independent process-global owner maps with one stable `PatchBroker`. Each pristine method is captured once; wrappers resolve an owner-scoped active binding. Consolidate loader/spinner activation into the package entry point. Stress reload, overlapping children, non-LIFO teardown, and stale callbacks.

### 4. Introduce semantic transcript projection

Normalize host transcript components into immutable semantic records. Derive grouping and layout from records rather than literal component adjacency. Return rendered lines and click geometry together. Keep unknown components native and visible components as barriers.

### 5. Return built-in execution to Pi

Cut over one family at a time. Observe `tool_call`/`tool_result` for bounded presentation provenance; never re-execute or recreate external definitions. Preserve Pi's schemas, cancellation, settings, prompt metadata, and result contracts. Keep per-family rollback until the version matrix passes.

### 6. Isolate additive tools

Narrow registration coordination to Cron and Ask. Register only when absence is proven; preserve external or unknown owners. Keep tools independent, mode-aware, and tied to runtime cancellation.

### 7. Cut over and delete legacy paths

Select the new tested adapter by default, retain `portable`, keep `legacy` for one release, then delete old owner maps, override execution, and timed handoff paths only after their replacement gates pass.

## Required gates

Every phase must pass unit tests, strict TypeScript, package whitelist and packed-consumer checks, Pi 0.74/0.80/0.85/latest, Meta startup, and all real PTYs. Additional gates cover resource counts over repeated reloads, overlapping child sessions, external tool identity, native fallback, historical/live parity, width/theme changes, malformed provenance, and feature-plan reasoning.

## Upstream seams

The internal ports should be directly replaceable by future Pi APIs for:

- disposable tool/command/UI registrations;
- extension generation identity and `AbortSignal`;
- presentation-only tool decorators;
- stable transcript-row identity and composition;
- complete branch-revision notifications;
- public rendered-row geometry and input routing;
- trustworthy tool ownership metadata and fallback registration.

These APIs simplify the tested adapter when available; their absence does not block the migration.
