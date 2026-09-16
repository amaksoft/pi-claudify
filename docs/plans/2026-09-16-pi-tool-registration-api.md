# Pi tool-registration APIs that would simplify Claudify

Status: proposal informed by real Pi 0.74/0.80/0.85 and Pi-at-Meta probes.

## Verified current contract

- `registerTool()` is valid during extension factory evaluation and after startup.
- Runtime action reads such as `getAllTools()` are unavailable during factory evaluation and throw `Extension runtime not initialized`.
- Post-start registration refreshes the effective and active/model-visible tool catalogs.
- Every package manifest extension entry loads; package scope was not the cause of missing Cron/Ask tools.
- Reload rebuilds runner-owned registrations and rejects stale-generation API calls.
- `getAllTools()` returns metadata (`ToolInfo`), not executable definitions; it must never be fed back into `registerTool()`.

The Cron/Ask outage was local: Claudify's deferred coordinator treated a name absent from a complete live registry as an existing tool with unknown ownership. The fix distinguishes `!owners.has(name)` from a present metadata-less entry.

## Minimal upstream improvements

### Document and type extension phases

Expose `phase: "loading" | "runtime" | "disposed"` and throw a stable typed phase error for runtime-only calls during loading. Document explicitly that registration methods are load-safe while action/introspection methods are runtime-only.

### Return registration handles

`registerTool()` should return an owner-scoped handle with effective/shadowed state and `dispose()`. This would make collisions and teardown observable instead of requiring a point-in-time `getAllTools()` check.

### Add fallback declarations

Support `registerTool(definition, { mode: "fallback" })`: the declaration is effective only while no exclusive declaration owns the name, becomes shadowed deterministically, and reappears when the exclusive owner is removed. This matches Claudify's additive Cron/Ask policy without check-then-register races.

### Add presentation-only decoration

Provide `decorateTool({ name, owner?: "builtin" }, { renderCall, renderResult, promptSnippet, promptGuidelines })`. Decoration must never acquire execution ownership and must be generation-scoped. This would eliminate Claudify's built-in executable overrides and private prototype renderer patch.

### Provide generation-scoped disposal

Expose an extension-generation `AbortSignal` plus `onDispose()`. Registrations, decorators, timers, and listeners created through handles should be disposed automatically on reload/removal.

### Ship a production-backed extension test host

The harness should use Pi's real loader, lifecycle, registry, active-tool filtering, reload behavior, and provider tool serialization. It should support package paths, multiple manifest entries, direct files, collisions, TUI/non-TUI modes, and captured model-request tool schemas. FakePi remains useful for unit tests but should be explicitly non-conformant.

## Useful but not required for this incident

Immutable host-issued owner/generation IDs and structured collision diagnostics would be valuable. A transactional immutable tool catalog or two-phase reload protocol is not required to fix the reproduced Cron/Ask issue; current Pi reload and dynamic registration behavior is coherent in tested versions.
