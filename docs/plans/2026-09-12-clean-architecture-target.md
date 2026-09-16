# Clean architecture target for pi-claudify

Date: 2026-09-12
Status: target architecture and incremental migration guide

## Decision: semantic Claude palettes, not an application theme

Pi remains the sole application-theme owner. Claudify owns only capture-backed
semantic presentation colors for surfaces it renders (tool status, diff rows,
inline code, spinner), selected by `colorSource`. A package theme would require
selection, collide with Pi's theme lifecycle, and fail to style transcript
semantics that have no theme token. All captured values belong in one typed
palette module; active Pi theme values are read only in explicit theme mode or
when terminal polarity is unknowable.

## Target dependency graph

```text
extension.ts (composition root)
├── lifecycle/runtime.ts
│   ├── host-capabilities.ts
│   ├── presentation-epoch.ts
│   └── patch-registry.ts
├── settings/
│   ├── store.ts
│   ├── effective-profile.ts
│   └── schema.ts
├── terminal/
│   ├── metadata-sanitizer.ts
│   ├── content-sanitizer.ts
│   ├── command-audit-codec.ts
│   └── ansi-layout.ts
├── tools/
│   ├── native-contract-adapter.ts
│   ├── presentation-registry.ts
│   ├── builtin-presenters.ts
│   ├── mcp-presenter.ts
│   └── generic-presenter.ts
├── transcript/
│   ├── inspection-policy.ts
│   ├── inspection-group.ts
│   ├── expansion-coordinator.ts
│   └── reconciliation.ts
├── diffs/
│   ├── source-model.ts
│   ├── provenance.ts
│   ├── syntax-service.ts
│   ├── palette.ts
│   ├── renderer.ts
│   └── async-card.ts
└── ui/
    ├── banner-controller.ts
    ├── prompt-editor.ts
    ├── footer-controller.ts
    └── settings-screen.ts
```

Dependencies point inward: host adapters call pure policies/renderers; pure
modules never import extension lifecycle state.

## Text types

Do not pass undifferentiated strings across terminal boundaries. Use explicit
constructors/types for:

- `RawStructuredText`: must be parsed before sanitization (`apply_patch`);
- `CommandAuditText`: collision-free visible encoding, printable bytes retained;
- `TerminalMetadata`: one logical line, controls/bidi removed;
- `TerminalContent`: multiline, grapheme-preserving, controls removed;
- `TrustedAnsi`: generated only by theme/palette/render helpers.

Trusted ANSI is applied last. Rendered rows are never sanitized after styling.

## State ownership

| State | Owner |
| --- | --- |
| pristine host methods and stable shims | process patch registry |
| active delegates and presentation epoch | extension generation |
| settings, palette, transient preview | extension runtime |
| timers, cost, prompt count | session |
| pointer-opened membership | transcript epoch |
| width/epoch cache and pending build | mounted component |
| old/new diff provenance | individual persisted tool result |

No module-level Set/Map may retain transcript components without an epoch and a
session cleanup path.

## Tool execution boundary

Pi owns execution, schemas, queues, trust, shell selection, and native settings.
Claudify decorates presentation. Where Pi does not expose a safe renderer hook:

- core overrides forward every public contract and effective trusted setting;
- public metadata may classify presentation only;
- execution is never re-registered from private `getAllTools()` fields;
- ambiguous tools remain native;
- missing atomic mutation provenance is displayed as unavailable, never inferred
  from a racy filesystem transition.

## Render pipeline

```text
raw tool/result model
→ parse structure
→ sanitize untrusted leaves by text type
→ pure presentation model
→ apply Claude/theme semantic palette
→ width-aware renderer
→ mounted component cache keyed by width + presentation epoch
```

The composition root wires these stages but contains no formatting grammar.

## Test architecture

1. Pure unit tests: sanitizers, grammars, diff models, palettes, row budgeting.
2. Component tests: width/epoch caches, lifecycle, pointer state, ownership.
3. Tool contract tests: actual registered definitions and trusted settings.
4. PTY tests: native Pi 0.85 mouse, key, reload/new, teardown.
5. Compatibility lanes: Pi 0.74/0.80/0.85 full suite and strict types.
6. Packed-consumer test: install the tarball outside the repository and render a
   highlighted diff.
7. Live Claude captures: only for unresolved visual/grammar questions.

Tests should assert observable behavior and provenance, not private cache field
shapes, except at the explicit host-adapter boundary.

## Incremental migration

1. Keep extracted safety/settings/diff/group modules as the stable inner layer.
2. Move each builtin presenter from `index.ts` into `tools/builtin-presenters.ts`
   without behavior changes.
3. Move apply-patch and mutation provenance into `diffs/` modules.
4. Replace scattered globals with one runtime object created by the extension
   factory and passed to controllers.
5. Reduce `index.ts` to patch installation, tool registration, lifecycle wiring,
   and feature-controller construction.
6. When Pi exposes transcript composition and public renderer decorators, delete
   the stable prototype shim and execution replacements rather than layering new
   compatibility code over them.

A ground-up rewrite is not recommended before those Pi-core APIs exist. The safe
path is strangler-style extraction with the current capture and PTY suites as
behavioral gates.
