# Claude Code task list — capture and reproduction design

Date: 2026-08-01
Status: capture-backed investigation; implementation not started

## Goal

Reproduce Claude Code's live task list in Claudify without replacing the task tools,
maintaining a second task store, or guessing state from stale transcript rows.

The target is the task list attached to Claude Code's working indicator and editor, not
the individual `TaskCreate`, `TaskUpdate`, or `TaskList` tool rows in the transcript.

## Capture method

Ground truth was captured from **Claude Code v2.1.220**, **Haiku 4.5**, in a real cmux
terminal at `~/Projects/claudify`.

Three capture paths were used:

1. `cmux read-screen` snapshots during task creation, status changes, shell execution,
   and the final idle state.
2. ScreenCaptureKit screenshots through Orca computer use, including a half-width cmux
   split to force truncation.
3. A second Claude session launched under macOS `script` so the raw TTY stream retained
   cursor movement and exact SGR color/style sequences.

The prompts created completed, in-progress, and pending tasks simultaneously. One sample
also gave the in-progress task an `activeForm` different from its subject, which reveals
which field each surface renders.

Evidence:

- [`captures/2026-08-01-cc-task-list/mixed-state-wide.png`](captures/2026-08-01-cc-task-list/mixed-state-wide.png)
- [`captures/2026-08-01-cc-task-list/mixed-state-narrow.png`](captures/2026-08-01-cc-task-list/mixed-state-narrow.png)
- [`captures/2026-08-01-cc-task-list/claude-v2.1.220-haiku.ansi`](captures/2026-08-01-cc-task-list/claude-v2.1.220-haiku.ansi)

## Captured grammar

### While Claude is working

The task list is subordinate to the animated working row. It has no count header and no
blank line between the working row and the list:

```text
✽ Sampling active task color… (25s · ↓ 890 tokens)
  ⎿  ✔ Completed sample
     ◼ Active sample
     ◻ Pending sample
```

The first task uses Claude's `⎿` result gutter. Following tasks align with the first
marker by replacing the gutter with five spaces.

The global working phrase uses the active task's `activeForm` (`Sampling active task
color…`). The task row itself uses the task **subject** (`Active sample`), not the
`activeForm`.

### When Claude is idle and unfinished tasks remain

The same state becomes a persistent widget immediately above the editor:

```text
  3 tasks (1 done, 1 in progress, 1 open)
  ✔ Completed sample
  ◼ Active sample
  ◻ Pending sample
```

The header always names all three buckets, including zero values. A second capture
showed:

```text
  5 tasks (4 done, 1 in progress, 0 open)
```

Counts are bold; the rest of the header is dim gray.

### Row styling

Raw TTY values from the `script` capture:

| State | Marker | Marker style | Subject style |
|---|---|---|---|
| Completed | `✔` | RGB `78,186,101` | RGB `153,153,153`, strikethrough |
| In progress | `◼` | RGB `215,119,87` | default foreground, bold |
| Pending | `◻` | default foreground | default foreground |

Additional visible details:

- Every standalone line begins with two spaces.
- Task IDs are not displayed.
- The in-progress marker is static. There is no per-task spinner.
- Per-task elapsed time and token counts are not displayed.
- A long subject is truncated with `…`; it does not wrap.

The captured rows stayed in creation order rather than regrouping by status. The first
sample also showed a fully completed list while Claude was still working, then no widget
after the final response. This is consistent with completed-list clearing, but the exact
clear cadence was not isolated separately.

## Current pi behavior

Pinned runtime during investigation:

- `@earendil-works/pi-coding-agent` 0.80.6
- `@tintinweb/pi-tasks` 0.7.2
- Claudify commit `c40667e`

The task tools are owned by `@tintinweb/pi-tasks`, not pi core. It registers
`TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, `TaskStop`, and
`TaskExecute` in `.pi/npm/node_modules/@tintinweb/pi-tasks/src/index.ts`.

The authoritative live state is its private `TaskStore`. Its `TaskWidget` registers a
custom widget under key `"tasks"`:

```ts
ctx.ui.setWidget("tasks", factory, { placement: "aboveEditor" });
```

That factory reads the store on every render and already owns task persistence, session
switching, subagent completion, auto-cascade, active-task metrics, and repaint timing.

With Claudify loaded, the current pi widget renders approximately:

```text
● 4 tasks (1 done, 1 in progress, 2 open)
  ✔ #1 Capture Claude task-list rendering
  ✸ #2 Inspecting Claudify rendering seams… (11m 50s · ↑ 9.8k ↓ 790)
  ◻ #3 Verify pi extension APIs
  ◻ #4 Document recreation approach › blocked by #2
```

### Delta

| Surface | Claude Code | Current pi-tasks widget |
|---|---|---|
| Active placement | Attached to working row with `⎿` | Separate widget after a blank line |
| Idle header | Dim counts, no bullet | Accent `●` header |
| IDs | Hidden | Shown on every row |
| In-progress marker | Static salmon `◼` | Animated accent star when active |
| Active text | Bold subject | Accent `activeForm…` plus metrics |
| Completed | Green check, gray strikethrough subject | Green check, gray strikethrough ID + subject |
| Zero counts | Always shown | Omitted |
| Narrow subject | Truncated with `…` | Truncated with `…` |

## Why transcript rendering is not the seam

Claudify already recognizes the task tools in `extensions/index.ts` and has a dedicated
`renderTaskListResult()`. That renderer only receives the text returned by one
`TaskList` call:

```text
#1 [pending] Subject
#2 [in_progress] Subject
```

It is a historical transcript snapshot. Later `TaskUpdate` calls do not revise it.
`TaskCreate` and `TaskUpdate` results also return plain text with `details: undefined`.

Reconstructing a second store from tool calls would still miss:

- updates made in pi-tasks' `/tasks` UI;
- automatic subagent completion and failure handling;
- auto-cascade and auto-clear behavior;
- session restoration and scope changes;
- future pi-tasks mutation paths.

Therefore the transcript parser and a shadow task store are both rejected.

## Available pi seam

The public pi API supports `ctx.ui.setWidget(key, componentFactory, options)`, but it has
no `getWidget()` method and no cross-extension task-store API.

Pi does export `InteractiveMode`. Its JavaScript prototype contains the internal
`setExtensionWidget(key, content, options)` method used by every public `setWidget()`
call. Claudify already uses guarded prototype patches for transcript components, so a
guarded patch here fits the existing architecture and works regardless of whether
Claudify or pi-tasks appears first in package load order.

`InteractiveMode` also has `renderWidgetContainer(...)` and `clearStatusIndicator(...)`.
Pi normally inserts a fixed leading `Spacer(1)` before all above-editor widgets, which is
the blank line that prevents the active list from joining the working row. With
`clearOnShrink`, `clearStatusIndicator()` installs an `IdleStatus` that renders two blank
lines after the working indicator clears. These private surfaces must be
capability-checked together; partial patching is not a safe fallback.

## Recommended design

### 1. Wrap only the `"tasks"` widget factory

Before patching, verify that `setExtensionWidget`, `renderWidgetContainer`, and
`clearStatusIndicator` are functions. Patch none if the capability set is incomplete.
Use one `Symbol.for(...)` registry for the group so reload cannot leave a half-installed
behavior.

The registry must live on `globalThis` and hold the mutable normalizer implementation,
subject cache, staged tool-call data, and per-mode working-message state. A fresh
Claudify module updates that shared registry on reload; the once-installed prototype
closures delegate to it. A permanent `Symbol.for` guard around module-local closures is
not sufficient because fresh tool-event handlers would otherwise update a different
cache after `/reload`.

Pass every non-task key through unchanged. Before delegating an `undefined` clear for key
`"tasks"`, reset the shared active-form override and recognized-render state so the
spinner and spacing patches cannot retain stale task state. For key `"tasks"` with a
component factory:

1. Call the original factory to obtain pi-tasks' component.
2. Return a marked wrapper component.
3. On each `render(width)`, call the original component first and rebuild only recognized
   pi-tasks grammar.
4. Forward `invalidate()` to the original component. On wrapper `dispose()`, reset
   active-form/recognition state before forwarding optional original disposal.
5. On empty output or parse failure, reset the same shared state and reproduce the
   original spacer and lines exactly rather than hiding task state.

This preserves the private `TaskStore`, timer, `tui.requestRender()` calls, and widget
lifecycle. The marker lets the container patch distinguish a successfully wrapped task
component from an unrelated widget that happens to use key `"tasks"`.

### 2. Use the live InteractiveMode state for active versus idle grammar

The wrapper can close over the `InteractiveMode` instance intercepted by
`setExtensionWidget`. At render time:

- indicator kind `"working"` → render the `⎿` form without a header;
- no active indicator → render a leading blank line, count header, and standalone rows;
- retry, compaction, branch-summary, or unknown kinds → preserve pi-tasks' original UI.

No second timer or agent-state machine is needed. If the instance does not expose the
expected active-status field, the wrapper returns pi-tasks' original component unchanged.

The capture also requires the global working phrase to use `activeForm` while the row
uses the subject. The wrapper writes the sanitized parsed/cached active form into the
shared registry and clears it when no active row remains. Normalize empty `activeForm`
as absent and fall back to subject, matching pi-tasks. If multiple visible active tasks
exist, the lowest numeric ID owns the one global phrase; hidden overflow tasks cannot
participate, and this deterministic extension behavior is not claimed as Claude grammar.

`extensions/spinner.ts` sanitizes the override with the existing ANSI/control-character
and length rules, then substitutes it for `currentVerb` inside `buildWorkingMessage()`.
This preserves ellipsis, shimmer colors, elapsed duration, token count, and thinking
suffix. The existing refresh loop applies the change on the next frame; do not add a
timer or call `setWorkingMessage()` from the task component.

### 3. Let the task widget own its dynamic spacer

Guard-wrap `InteractiveMode.prototype.renderWidgetContainer` only when the marked task
component is the sole above-editor widget. In that common case, suppress pi's fixed
leading spacer and let the wrapped task component emit one blank line only in idle mode.
Working mode emits no leading blank.

If another above-editor widget is present, preserve pi's original order and spacer. Exact
working-row attachment is then intentionally degraded rather than reordering unrelated
extension UI. On parse fallback, the marked component emits the removed blank itself, so
the visual result remains a true passthrough.

A shared reconciliation helper runs after task-widget registration/replacement and after
`clearStatusIndicator()`. It removes the two-line `IdleStatus` only when the recognized
task component is the sole above-editor widget and supplies its own idle blank. Record
that suppression per mode. If layout later becomes multi-widget or parsing falls back,
restore the original `IdleStatus` only when that recorded suppression occurred and
`clearOnShrink` is enabled. Validate sole↔multi and recognized↔fallback transitions with
`clearOnShrink` both enabled and disabled; do not ship from assembled output alone.

### 4. Normalize rows from the original rendered data

Parse ANSI-stripped pi-tasks rows strictly:

- `✔ #<id> <subject>` → completed;
- `◼ #<id> <subject>` → in progress;
- any pi-tasks star frame plus `#<id> <activeForm>… (<metrics>)` → active in progress;
- `◻ #<id> <subject>` → pending;
- `● <counts>` → aggregate counts.

Cache `id → { subject, activeForm }` whenever rendered rows or successful tool events
expose those fields. For create-and-start batches, stage `TaskCreate`'s subject and
`activeForm` by `toolCallId` on `tool_execution_start`, then bind them only when final
result text matches `Task #<id> created successfully`. Apply the same staging to
`TaskUpdate`, but commit only when result text matches `Updated task #<staged id>`;
pi-tasks reports a missing ID as non-error text. Normalize empty active forms as absent,
then fall back to subject. Clear caches on session replacement.

Sort recognized visible rows by numeric task ID so pi-tasks' optional status/recent sort
modes do not reorder that visible subset. Recognize and preserve its dim `… and N more`
overflow row for both `hiddenAt` positions. Because pi-tasks chooses the subset before the
wrapper sees it, overflow membership cannot be restored to creation order.

Pi-tasks truncates headers and rows before the wrapper receives them. Do not guess missing
counts or text: a clipped aggregate header with overflow passes through unchanged. On a
cold resume, pi-tasks does not restore its private active-ID set, so an in-progress task
exposes only its subject; render the static in-progress row and leave the active-form
override unset until a new activation exposes it. These are unavoidable fidelity limits
of the absent public task-state API.

### 5. Preserve task-package-only safety information deliberately

Claude Code's task schema does not expose pi-tasks' blockers, owners, or agent metadata.
Do not silently make a blocked task look actionable. Preserve a dim
`› blocked by #…` suffix when present. Owner/agent labeling should likewise remain a dim
suffix if pi-tasks supplies it. These are intentional functional extensions, not claims
about Claude Code's captured grammar.

### 6. Keep scope narrow

Do not replace or re-register the task tools, read pi-tasks JSON files directly, or add
pi-tasks as a Claudify runtime dependency. Leave `renderTaskListResult()` transcript
history unchanged. The first implementation adds neither a setting nor another timer or
persistence layer.

If pi-tasks is absent, or another widget uses key `"tasks"` with a different line grammar,
the patch is a no-op/passthrough.

## Suggested implementation surfaces

- A focused `extensions/task-list.ts` module containing the shared patch registry, the
  guarded widget/container/status prototype patches, and the pure row-normalization
  helper.
- One call from `extensions/index.ts` during extension initialization.
- A narrow `extensions/spinner.ts` change that consumes the shared active-form override
  inside `buildWorkingMessage()`.
- `scripts/test-task-list.ts` plus the existing spinner-cadence suite for rendering,
  wrapper lifecycle, and suffix-preserving active-form behavior.
- `package.json` test chain and `files` list updates if the focused module is added.

No settings, storage, command, or task-tool changes are required.

## Test contract

### Captured rendering

1. Active mixed state has no header or blank line, uses a first-row `⎿`, and aligns
   continuation rows. The global phrase uses the lowest-ID visible active task's sanitized
   non-empty `activeForm` (or subject) while retaining suffixes; rows use cached subjects.
2. Idle mixed state has the count header plus completed, in-progress, and pending rows;
   every standalone header/task line begins with exactly two spaces and every available
   count bucket remains present at zero.
3. Raw-ANSI assertions pin bold count tokens, the dim-gray header, completed green plus
   gray strikethrough, the salmon in-progress marker plus bold subject, and an unstyled
   pending row to the captured SGR values.
4. A fixture whose visible creation order differs from status order is normalized by
   numeric ID. IDs and per-task metrics are absent; blocker and owner suffixes remain dim.
5. Narrow widths truncate with `…` without exceeding width. More-than-ten-task fixtures
   preserve both overflow positions; clipped aggregate headers pass through rather than
   inventing missing buckets or hidden-row membership.

### Compatibility and lifecycle

1. Create/update staging commits only when final text matches the expected success grammar
   and staged ID; errors and non-error `Task #<id> not found` results cannot poison caches.
2. Cold resume renders the subject-only static in-progress row and leaves the active-form
   override unset until a new activation exposes that field.
3. `invalidate()` reaches the original; wrapper disposal, clearing `"tasks"`, empty
   output, and parse fallback reset active-form/recognition state before passthrough.
4. Malformed grammar, non-working status kinds, pi-tasks absence, and partial private API
   retain original UI. Sole↔multi and recognized↔fallback transitions reconcile
   `IdleStatus` correctly with `clearOnShrink` enabled and disabled.
5. Reloads do not stack wrappers; fresh handlers update the shared registry. A fake-timer
   check proves Claudify adds no interval, and a live active-task reload smoke verifies one
   visible widget with no duplicate animation despite the known upstream pi-tasks leak.

Before release, run the full suite and strict manual typecheck from `AGENTS.md`, then the
required real-PTY smoke test against the local checkout with pi-tasks enabled. The smoke
must inspect active and idle mixed lists with `clearOnShrink` enabled and disabled because
assembled tests do not validate pi's private widget-container contracts.

Completed-list clearing remains owned by pi-tasks in this slice. Before changing that
behavior, isolate a Claude capture that moves a fully completed list from working to idle
and codify the exact clearing point; do not infer it from the current mixed-state sample.

## Main risk

The chosen seam is intentionally narrow but internal: `setExtensionWidget`,
`renderWidgetContainer`, `clearStatusIndicator`, and `activeStatusIndicator` are private
`InteractiveMode` details. They are present in pi 0.80.6 and remain represented only
indirectly by the public 0.83 widget/working APIs; a pi refactor could rename their
implementation. Guard the capability group atomically, fail open, and treat the live
smoke test as mandatory for releases that update pi.

Pi-tasks 0.7.2's factory component has no `dispose()`, so Claudify cannot stop the owning
`TaskWidget`'s active 150 ms interval during a reload; that is a pre-existing active-only
pi-tasks lifecycle leak, not a reason to build a second store here. Forward disposal if a
future component exposes it. Record this dependency bug in an upstream pi-tasks issue
before implementation so reload-smoke evidence has a durable reference.
