# Pi-core follow-ups for claudify

Date: 2026-09-11
Status: documented for a separate Pi-core session

These are not extension TODOs to solve with more prototype patches or terminal
control tricks. They require public host contracts or changes in Pi itself.

## 1. Transcript composition API

Claudify currently patches `Container.prototype.render` to reconcile adjacent
tool rows into interactive aggregate components. A public transcript composition
hook should allow an extension to inspect/replace a run of transcript components
before layout while preserving child ownership, invalidation, selection, images,
and hit maps.

Desired contract:

- stable transcript-node identity;
- replace/dissolve a run atomically;
- public settled/expanded tool state;
- host-owned links, images, selection, and mouse layout;
- no process-global prototype mutation.

## 2. Public tool presentation state

The extension currently centralizes private `ToolExecutionComponent` access in
`pi-tool-adapter.ts`. Pi should expose settled, partial, expanded, result, cwd,
and renderer state through a stable interface. This would remove compatibility
probes and make aggregation safe across host releases.

## 3. Fullscreen composition and mode switching

Pi 0.85's real pointer dispatcher lives in native `TuiAltScreen`. Writing
alternate-screen and mouse-reporting escapes around the regular renderer cannot
create pointer dispatch. Extensions need either:

- a public session-local switch to native fullscreen mode; or
- a public viewport/transcript host component usable in either mode.

Until then `/tui` can provide a bounded transcript and wheel listener, while
per-component clicks require starting Pi with `--tui-mode fullscreen`.

## 4. Physical row-background fill

Claudify produces width-padded diff rows, but Pi's final frame rendering trims
styled trailing blank cells. Claude's direct terminal writer retains the red or
green background to the physical right edge. The correct fix is a host-level
row/background primitive, not NBSP/zero-width anchors or CSI erase-to-EOL from an
extension.

## 5. Markdown table alignment and synchronous highlighting hooks

Pi's Markdown table renderer ignores parsed alignment (`---:`, `:---:`), and its
synchronous fenced-code highlighter is tied to the active application theme.
Claudify should not fork the parser or perform fragile ANSI table surgery.
Useful host APIs would expose:

- table-column alignment from parsed tokens;
- a semantic syntax-token callback/palette;
- synchronous custom highlighter registration; or
- an async Markdown component contract with guarded repaint/cache semantics.

## 6. Background process lifecycle and contextual shortcuts

Claude's double-`Ctrl+B` backgrounding requires host ownership of the active tool
execution, shortcut context, detachment, job identity, and later output routing.
An extension can spawn a process but cannot faithfully detach Pi's current tool
call or reserve a shortcut only while that execution is foregrounded.

Desired contract:

- active execution handle;
- detach/background operation;
- contextual shortcut registration;
- job status/output events;
- cancellation and session-shutdown semantics.

## 7. Keybinding-aware partial expansion

Pi's global tool expansion state is separate from per-component expansion. The
extension currently coordinates pointer-opened groups at the raw-input boundary
so one `ctrl+o` collapses visibly-open local detail. A public expansion-state
API should represent `collapsed`, `global`, and `partial` states and route the
configured `app.tools.expand` binding rather than requiring a literal Ctrl+O
listener.

## Non-goals for the extension

Do not solve these by:

- adding more global prototype patches;
- mutating private InteractiveMode fields;
- emitting destructive terminal erase sequences;
- replacing Pi's Markdown parser;
- intercepting every user keybinding globally;
- reimplementing Pi's process/job manager.
