# Blind expert review resolution

Date: 2026-09-12
Source review: `/tmp/pi-claudify-blind-review.md`
Status: implementation and local compatibility gates complete; remote CI/release pending

## Release findings

| Finding | Resolution |
| --- | --- |
| F01/F21 trust + agent directory | `hostToolSettings` now receives affirmative project trust and Pi's effective agent directory. Missing/failing trust is untrusted. Tests cover trusted/denied/absent trust, `PI_CODING_AGENT_DIR`, shell path/prefix, and image resize. |
| F04 banner trust/safety | Project settings/skills require trust; global resources use the effective agent directory; every metadata leaf is sanitized before caching/layout. Header installation is ownership-aware and initial `off` installs nothing. |
| F05 destructive Bash audit | Expanded commands use visible control-byte encoding and retain every printable payload/metacharacter; collapsed summaries keep one-line sanitization. 7-bit and C1 envelope tests preserve executable syntax without emitting controls. |
| F06 flattened apply_patch | Patch text stays raw through structural parsing; only parsed paths/body leaves reach display sanitizers. Actual ToolExecution preview tests cover multiline/multi-file input. |
| F07 edit provenance | Native queue-owned `details.patch` is the only accepted history provenance. Patchless hosts persist `diffUnavailable`; no out-of-queue before/after snapshot is presented as file truth. |
| F13 oversized new files | UTF-8 new-content bytes are limited independently of snapshot kind; oversized new writes persist `diffOmitted` and restore to a bounded explanation. |
| F18 expanded output contract | One `DEFAULT_EXPANDED_PREVIEW_MAX_LINES = 4000` now drives runtime, settings UI, and example config. Boundary and explicit-low-cap tests are retained. |

## Other verified findings

| Finding | Resolution |
| --- | --- |
| F09 runtime cwd links | Built-in labels and OSC-8 targets resolve from renderer/execution `ctx.cwd`, with a decoded-target regression test. |
| F11 public ToolInfo MCP | Discovery records only provable public identity and never re-registers execution through private fields. `mcp__server__tool` is enhanced; ambiguous bare names remain native. README promise narrowed. |
| F12a unknown polarity | Theme polarity returns `dark`, `light`, or `unknown`; names provide a fallback, and unknown themes retain transparent backgrounds plus semantic theme foregrounds in both Claude and theme diff modes. |
| F14 callback failure | DiffCard settles state before a separately guarded, once-only notifier; throwing callbacks cannot replace successful rows or reject the terminal promise. |
| F15 mounted revisions | DiffCard identity includes a presentation epoch. Theme changes, syntax changes, and transient diff previews bump the epoch at fixed width. |
| F16 reload generation | Container and ToolExecution hooks use stable Symbol registries with replaceable generation delegates and owner tokens. The old boolean Container guard migrates via the process-captured pristine renderer; a pre-registry ToolExecution hook emits a one-time restart warning. Reused groups refresh policy. |
| F17 emoji graphemes | Content sanitizer validates complete `Intl.Segmenter` graphemes and preserves modifiers, VS16, and emoji ZWJ clusters while stripping standalone spoofing joiners. |
| F19 banner off | Initial off does not call `setHeader`; transitions use observed disposal ownership and never blindly clear a later owner. |
| F22 CRLF spaces | Inputs and persisted patches normalize CRLF before diff parsing; genuine trailing spaces remain. |
| F23 H1 source mutation | Source rewriting was removed. Native Markdown semantics win over forced italic parity; complex H1 regression cases are pinned. |
| F26 prompt editor | Prompt editor preserves embedded working status, uses ordinary foreground for `❯`, and leaves `!` shell input native. |
| F27 token final zero | Per-turn finish is idempotent and settles the maximum of stream high-water and final usage. |
| F28 stale pointer members | Pointer membership is transcript-epoch scoped, cleared on session/compaction/tree replacement, and consumes Ctrl+O only when a current member really collapses. |
| F29 width build fan-out | DiffCard uses latest-wins scheduling with at most one active and one queued width/epoch request. |
| F31 false-positive reparenting | Tool identity requires the characteristic ToolExecution constructor name and mutation/render surface, without cross-package `instanceof`. Uncertain components stay native. |
| F33 quadratic reconciliation | Reusable wrappers are indexed by first-member identity; N/2N instrumentation pins near-linear candidate checks. |
| F34 inaccurate hidden rows | Visual preview uses an exact streaming grapheme/line scanner with bounded head storage or tail ring. |
| F35 invented fallback coordinates | Missing authoritative patch and bounded preimage produce `diffUnavailable`; no operation-local coordinates/order are presented as file truth. |
| F37 shimmer inheritance | UI uses the runtime resolver, labels inherited versus explicit state, and first toggle from theme-inherited off writes true. |

## Packaging and tests

- Shiki, language, and theme packages are pinned to the same exact version.
- Forgejo actions are pinned to reviewed commit SHAs.
- CI installs the tarball in a clean consumer and executes a representative syntax-render path.
- Real Pi 0.85 PTY fixture loads the complete extension and exercises `/reload`, `/new`, clicks, pointer collapse, and teardown.
- Full suites and strict typechecks pass locally on Pi 0.74.0, 0.80.6, and 0.85.1.
- A clean tarball consumer installs and renders a syntax-highlighted diff.
- New focused suites cover visual rows, DiffCard scheduling/epochs, banner trust/ownership, public ToolInfo MCP fallback, trust-aware built-ins, CRLF, audit encoding, and mutation bounds.

Static Shiki grammars remain eager because Pi's package sandbox rejected hidden dynamic subpath imports in a real packaged session. Local import measurements were roughly 0.45–0.85 seconds; changing this requires a packed-runtime loader design, not reintroducing the previously broken dynamic path.

## Architecture direction

The implementation now follows clearer ownership boundaries:

- Pi owns execution and native tool definitions.
- Claudify owns presentation adapters and capture-backed semantic palettes.
- Raw structured input is parsed before leaf sanitization.
- Command audit text, one-line metadata, multiline content, and trusted renderer ANSI use distinct policies.
- Persisted mutation history belongs to each tool result and is omitted when provenance is unavailable.
- Async mounted components own bounded scheduling and epoch-aware caches.
- Pointer state belongs to a transcript epoch; session lifecycle clears it.
- The global host shim is stable and generation-delegated rather than repeatedly wrapped.

Longer-term Pi-core API requests remain isolated in `2026-09-11-pi-core-followups.md`.
