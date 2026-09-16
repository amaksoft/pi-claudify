# Read-only aggregation: settle detection and recoverable detail

Date: 2026-09-07
Status: implemented, except the open gaps listed at the end

This is a **host capture**, not a Claude Code pixel capture. The rendering
grammar is unchanged and every existing capture-backed assertion still holds
(`scripts/test-readonly-aggregation.ts` is untouched). What is recorded here is
**pi's own behaviour**, established from the installed host sources and from
probes over real `ToolExecutionComponent` instances, because the aggregation
code depended on three host details and had two of them wrong.

Everything below is either asserted by a test or listed as an open gap. If you
add to this file, keep that property.

## Captured host behaviour

1. **`.result` exists from execution start — for tools that stream.**
   `dist/core/tools/bash.js` calls `onUpdate({content: [], details: undefined})`
   *before spawning*, which reaches `updateResult(result, isPartial = true)` in
   `dist/modes/interactive/components/tool-execution.js`. Completion re-calls it
   with `isPartial = false`; restored history rows arrive already `false`.
   So for **bash and the MCP proxy**, `!!result` means "started", not "finished".
   `read`, `grep`, `find` and `ls` take `_onUpdate` and never call it
   (`dist/core/tools/read.js:140` and siblings), so for those tools result
   presence really did mean completion — which is why the old predicate looked
   correct for pure-read groups and failed as soon as a shell command joined one.
   Observed lifecycle for one bash row:
   ```
   pre-result false | start-partial false | end true | errored true | aborted true | restored true
   ```

2. **Expansion state reaches a renderer as `ctx.expanded`, and re-renders.**
   `setExpanded(value)` assigns the field and calls `updateDisplay()`, which
   re-invokes `renderCall`/`renderResult`; `getRenderContext` copies the field
   into the context. Assigning `.expanded` directly does **not** re-render, so a
   test that pokes the field asserts against stale child components. pi's own
   `ctrl+o` handler (`setToolsExpanded`) walks the transcript children and calls
   `setExpanded`, so that method is the real entry point and needs no pointer.

3. **Escape bytes in a row are measured as zero-width.** `visibleWidth` ignores
   SGR, OSC 8, and CSI, but the terminal still acts on them: a charset shift
   (`ESC ( 0`) survives an SGR reset and redraws later rows as line art, and an
   unterminated envelope swallows what follows. A row carrying them therefore
   both corrupts the display and overflows the terminal, which pi treats as an
   error. `\n` and `\t` are *not* in the C0 range a naive strip covers.

4. **`result` and `isPartial` are `private` in the type surface** of pi 0.74.0,
   0.80.6 and 0.85.1 alike, and this code reads them off sibling components
   rather than through `ctx`. Their semantics are identical across those
   versions (every `updateResult` call site agrees), so the declared
   `peerDependencies: ">=0.74.0"` is not violated — but this is an unguaranteed
   internal, and a rename upstream breaks aggregation rather than a build.

## Recoverability is the invariant

Aggregation hides detail behind a summary, so it is safe **iff** expanding
reveals what was hidden. That property was assumed and did not hold:

- `stableCallSummary` latches its value once `argsComplete` is true, so a row
  first rendered collapsed could never widen. Per-expansion-state cache keys
  (`_callSummary` / `_callSummaryExpanded`) are what make expansion mean
  anything; without them every other fix here is cosmetic.
- Bash: the expanded header carried `summarizeText(command, 72)`. It now carries
  the whole command, wrapped against `toolHeader`'s `WRAP_MARK` hanging indent —
  including for read-like commands, whose friendly `f (lines 1-200)` target form
  is kept only while collapsed.
- MCP: the expanded header showed `server:tool` and never the parameters. It now
  shows them, from proxy mode's JSON string in `args.args` or direct mode's
  argument object, minus the routing keys that address the call rather than
  parameterise it.

Sanitizing serves the same invariant, which is why removed bytes leave a
`U+FFFD` marker instead of vanishing: an unterminated `ESC X` used to delete the
rest of a command, so `echo hello <ESC>X && rm -rf ~/x` rendered as
`echo hello` — a row that looks complete and is not. Deleting is not sanitizing
if the user cannot tell that something was deleted.

**New rendering that hides a detail must say where expanding shows it.**

## Tests asserting this capture

- `scripts/test-inspection-groups.ts` — the settle lifecycle across pending /
  streaming / finished / restored (capture 1); the aggregate staying open while
  any member streams; escape, NUL, charset-designator and OSC 8 stripping in
  target rows with a width invariant (capture 3); `\n`/`\t` row forging; the
  unterminated-envelope tail; bidi and zero-width spoofing; idempotence; CJK
  width.
- `scripts/test-bash-display.ts` — full command on expand, collapse→expand→
  re-collapse against the cache latch, the read-like command path, hostile
  escapes in a command.
- `scripts/test-mcp-display.ts` — parameters on expand in proxy and direct mode,
  empty envelope, routing keys, malformed JSON verbatim, hostile escapes.

## Capture: Claude Code v2.1.261, expansion model

Recorded live in tmux (`claude --dangerously-disable-osx-sandbox`, three files
read in one turn), because the partial-expansion question above could only be
settled by watching the real thing.

Default view collapses the run to one indented, bullet-less line — and does so
at **any** count, singletons included:

```
⏺ I'll read the three files in order.
  Read 3 files
⏺ Read all three:
```
```
❯ Use the Read tool on one.txt only. Then stop.
  Read 1 file
```

`ctrl+o` is a **global verbose-transcript toggle, not per-row expansion**. Every
row opens at once, and the footer names the mode:

```
⏺ Read(/Users/amaksoft/cc-capture/one.txt)
  ⎿  Read 4 lines
⏺ Read(/Users/amaksoft/cc-capture/two.txt)
  ⎿  Read 3 lines
⏺ Read(/Users/amaksoft/cc-capture/three.txt)
  ⎿  Read 2 lines

  Showing detailed transcript · ctrl+o to toggle · ↑↓ scroll · v to open in vi    verbose
```

Consequences for this extension:

1. The `Read 1 file` singleton form is confirmed from a live session, which is
   why the two-member minimum considered during development was dropped: it
   would have contradicted the product it imitates.
2. Claude Code offers **no way to expand one row and leave its neighbours
   collapsed**. pi does (`setExpanded` per component, plus fullscreen clicks),
   so pi can reach a state Claude Code cannot. "Capture, do not guess" therefore
   cannot answer what that state should look like — it has no upstream form.
3. Claude Code's expanded header shows the **absolute** path
   (`Read(/Users/amaksoft/cc-capture/one.txt)`); claudify shortens it. Existing
   deliberate divergence, noted here only so the next reader does not
   "correct" it from this capture.

## Pi-specific direct interaction

Claude Code has only global verbose mode, but pi 0.85 also has pointer-aware
transcript components. This extension deliberately uses that extra capability:

- Consecutive aggregatable tools are reconciled into one real
  `InspectionGroupComponent`, including singletons (`Read 1 file`). The component
  owns the summary lines it paints; this is not string splicing.
- A primary click on the settled summary invokes the members' real
  `setExpanded(true)` methods. On the next render the wrapper no longer validates
  as groupable and dissolves into the same native rows pi would have rendered.
  Links, output, status and ordinary per-tool behavior therefore remain native.
- `ctrl+o` duck-types `setExpanded` on transcript children, so it reaches the
  group component and follows exactly the same path. Clicking opens one group;
  `ctrl+o` remains the global all-groups toggle.
- While the wrapper paints its own summary, it installs
  `mouseLayout = {width, children: []}`. Otherwise pi 0.85's
  `Container.handleMouse` fabricates hit regions by rendering the invisible
  member rows at their natural heights, sending clicks below the summary to the
  wrong component. Stacked native Bash rows likewise publish the post-spacer-
  removal heights they actually painted.
- The parent `children` array is mutated in place during reconciliation, because
  host code may retain the array identity. A dissolving wrapper releases its
  members before the parent adopts them again.

The pinned pi-tui 0.80.6 does not yet define `mouseLayout` or `handleMouse`.
Assignment is therefore feature-tolerant and the wrapper's handler is tested
directly there. The full contract was additionally verified live against pi
0.85 in fullscreen using SGR mouse events:

```
before click:       Read 1 file
after click:      ⏺ Read(.../package.json)
                    ⎿ 84 lines loaded
```

With two read groups separated by an ungrouped Bash row, clicking the first
opened only it and left the second as `Read 1 file`; `ctrl+o` then expanded both,
and a second `ctrl+o` collapsed both.

This resolves the partial-expansion question as an intentional pi enhancement:
the state has no upstream Claude form, but its UX is defined—pointer targets one
group, keyboard targets all groups.

## Open gaps (not addressed here)

- **Sibling sinks.** Tool *output* bodies and the per-tool `Read`/`Write`/
  `Update`/`Grep` headers do not go through `sanitizeToolText`; a BEL in a path
  can still split an OSC 8 hyperlink. Verified identical on `master`, so this is
  pre-existing rather than a regression, but the sanitizer covers roughly half
  the sinks that reach a row.
- **No line cap on expanded detail.** A pathological 5,000-character command
  wraps to ~97 rows. Recoverability argues for showing all of it; Claude Code's
  behaviour here is uncaptured.
