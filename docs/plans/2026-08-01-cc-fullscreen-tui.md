# Claude Code fullscreen TUI — capture and implementation design

Date: 2026-08-01
Status: implemented and validated, including Orca trackpad scrolling
Issue: CLFY-30

## Goal

Add a session-local `/tui` toggle that gives Claudify Claude Code's fullscreen terminal layout while preserving Pi's existing transcript, streaming rows, editor, widgets, overlays, and footer.

The feature must pad short sessions so the editor and footer sit at the terminal bottom, stop padding when content fills the viewport, and restore Pi's ordinary terminal state on disable, reload, or shutdown.

## Capture method

Ground truth was captured from **Claude Code v2.1.220**, **Haiku 4.5**, in a real cmux terminal at `~/Projects/claudify`.

- A direct Claude session supplied ScreenCaptureKit screenshots and `cmux read-screen` snapshots for startup, working, idle, long transcript, half-width resize, and re-expansion.
- A second Claude session ran under macOS `script` to retain the exact terminal control stream through clean `/exit`.
- The capture ran against Claudify commit `c40667e`. The implementation target has `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` 0.80.6 installed.

Evidence:

- [`captures/2026-08-01-cc-fullscreen-tui/startup-wide.png`](captures/2026-08-01-cc-fullscreen-tui/startup-wide.png)
- [`captures/2026-08-01-cc-fullscreen-tui/working-wide.png`](captures/2026-08-01-cc-fullscreen-tui/working-wide.png)
- [`captures/2026-08-01-cc-fullscreen-tui/idle-long-wide.png`](captures/2026-08-01-cc-fullscreen-tui/idle-long-wide.png)
- [`captures/2026-08-01-cc-fullscreen-tui/working-narrow.png`](captures/2026-08-01-cc-fullscreen-tui/working-narrow.png)
- [`captures/2026-08-01-cc-fullscreen-tui/idle-narrow.png`](captures/2026-08-01-cc-fullscreen-tui/idle-narrow.png)
- [`captures/2026-08-01-cc-fullscreen-tui/idle-reexpanded-wide.png`](captures/2026-08-01-cc-fullscreen-tui/idle-reexpanded-wide.png)
- [`captures/2026-08-01-cc-fullscreen-tui/after-exit.png`](captures/2026-08-01-cc-fullscreen-tui/after-exit.png)
- [`captures/2026-08-01-cc-fullscreen-tui/claude-v2.1.220-haiku.ansi`](captures/2026-08-01-cc-fullscreen-tui/claude-v2.1.220-haiku.ansi)
- [`captures/2026-08-01-cc-fullscreen-tui/escape-sequences.txt`](captures/2026-08-01-cc-fullscreen-tui/escape-sequences.txt)
- [`captures/2026-08-01-cc-fullscreen-tui/pi-0.83-live-smoke.txt`](captures/2026-08-01-cc-fullscreen-tui/pi-0.83-live-smoke.txt)
- [`captures/2026-08-01-cc-fullscreen-tui/scroll-bottom.txt`](captures/2026-08-01-cc-fullscreen-tui/scroll-bottom.txt)
- [`captures/2026-08-01-cc-fullscreen-tui/scroll-page-up.txt`](captures/2026-08-01-cc-fullscreen-tui/scroll-page-up.txt)
- [`captures/2026-08-01-cc-fullscreen-tui/scroll-submit.txt`](captures/2026-08-01-cc-fullscreen-tui/scroll-submit.txt)

The directory also contains matching plain-text `read-screen` snapshots and ANSI captures.

## Captured behavior

### Terminal buffer lifecycle

Claude Code uses the alternate screen. The raw stream contains exactly one enter and one leave:

```text
startup: CSI ?1049h  CSI 2J  CSI H
exit:    CSI ?1049l
```

No `CSI 3J` scrollback clear appears in the Claude stream. Entering hides the pre-launch shell buffer; exiting restores it, including the sentinel written before Claude started. Claude's transcript is absent after exit.

This overturns the earlier normal-buffer-only assumption from the pi-spark precedent. Claudify must own and reverse an alternate-screen transition for `/tui`; a filler-only normal-buffer implementation would not match the capture.

### Short transcript

Claude renders its header at the top, inserts blank rows, and pins the existing editor plus statusline/footer to the bottom. While Claude works, the working indicator sits immediately above the editor and moves with the pinned lower chrome. When work settles, the remaining blank height expands again without moving the editor or footer.

### Long transcript

When transcript content reaches the viewport height, fill falls to zero. Claude does not hide or replace transcript content to preserve the pin; the terminal viewport shows the latest rows above the unchanged editor and footer.

### Resize and wrapping

A half-width cmux split triggers a clean full reflow. Long message rows wrap, footer content truncates, and the editor/footer remain bottom-aligned. Removing the split re-expands the same content cleanly with no stale rows. Fill therefore must be recalculated from the current terminal row count and the current fully rendered line array on every render.

### Editor, footer, and overlays

The capture shows one layout, not replacement versions of the transcript or editor. The implementation must run after Pi's normal child components render so streaming, tools, multiline editor height, widgets, `/claudify`, and the dynamic footer all participate in the height calculation.

## Pi seam

Pi has no public viewport-layout API. `ctx.ui.setWidget()` does provide the active `TUI` object to a persistent component factory. `TUI.render()` returns the complete base line array before Pi composites overlays and performs differential output.

The narrow implementation seam is therefore:

1. Register an invisible marker widget above the editor to capture the live `TUI`.
2. Wrap the renderer that exists at activation time.
3. Remove Pi's two full-width `IdleStatus` rows only when their exact rendered grammar appears immediately before the widget spacer.
4. Replace the marker with `max(0, terminal.rows - renderedLinesWithoutMarker)` blank rows.
5. Enter the alternate screen and force a redraw after the widget and wrapper are installed.

The marker keeps the filler above the existing editor and footer. It does not recreate, clip, reorder, or cache any child content. Overlay composition remains downstream in Pi's `TUI.doRender()`.

## Lifecycle and ownership

`/tui` is session-local and TUI-only. It adds no setting, timer, persistence, alternate transcript, or replacement editor.

Activation records:

- the exact renderer function being wrapped;
- Pi's previous `clearOnShrink` value;
- whether Claudify entered the alternate screen.

Deactivation and `session_shutdown`:

- disable the wrapper before removing the marker;
- restore the renderer only if it is still Claudify's wrapper;
- otherwise leave an inert delegating wrapper in a later extension's chain rather than clobber that extension;
- restore `clearOnShrink` and suppress any two-row `IdleStatus` mounted only because fullscreen temporarily enabled it;
- leave the alternate screen only when this activation entered it;
- force-reset Pi's differential-render state so reload and ordinary disabled rendering cannot reuse alternate-screen coordinates;
- strip only `CSI 3J` from the first normal-buffer repaint, preserving the restored scrollback;
- on process quit, clear the restored viewport after any queued repaint so stale Pi chrome cannot overwrite the returned shell prompt.

Repeated enable/disable calls are idempotent. Missing TUI capabilities fail closed with a visible notification and no partial terminal mutation.

### Transcript scrolling follow-up

A 70-line Claude Code v2.1.220 response in tmux confirmed that alternate-screen mode intentionally leaves tmux `history_size=0`; ordinary terminal or tmux scrollback cannot expose clipped transcript lines. At 158x51 the settled bottom viewport showed items 28–70. One Page Up moved Claude's own viewport to items 7–50 while leaving the editor/footer pinned and adding `Jump to bottom: fn+↓ to scroll` on the final transcript row. Page Down moved toward the live bottom, and a second Page Down restored items 28–70 and removed the hint.

Claudify must therefore own a bounded transcript viewport while fullscreen is active. Page Up and Page Down move it by approximately half the available transcript rows; the bottom state follows new streaming output, while a scrolled viewport stays anchored as output grows. Submitting from a scrolled viewport immediately returns to the live bottom before the new working/assistant rows appear. The raw key listener must consume paging keys only when Pi's ordinary editor remains focused, leaving pickers, overlays, `/claudify`, and multiline-editor paging untouched when no transcript overflow exists.

The same Claude ANSI capture enables DEC mouse modes `1000`, `1002`, and `1003`, followed by SGR mouse encoding mode `1006`. On exit it disables them in reverse order before leaving the alternate screen. Pi 0.83 exposes complete SGR input sequences through `ctx.ui.onTerminalInput`, so Claudify can map wheel-up (`64`) and wheel-down (`65`) events onto the same bounded viewport without replacing Pi's editor or input pipeline.

Mouse reporting must be active only while `/tui` owns the alternate screen. Recognized wheel events are consumed only while Pi's original editor retains focus; custom components and overlays retain their input ownership. Cleanup disables every enabled mouse mode before leaving the alternate screen on toggle, reload, Ctrl+D, SIGTERM, or failed activation. While mouse reporting is active, terminal-native text selection requires the terminal's mouse-bypass modifier, conventionally Shift.

## Test contract

1. Fill math pins short output to exactly the terminal row count, reaches zero for long output, responds to resize, removes only the marker, and suppresses only the exact two-row idle grammar.
2. The wrapper delegates normal rendering unchanged when disabled or when its marker is absent; overlays remain downstream.
3. Activation writes alternate-screen enter, enables clear-on-shrink, and requests a forced render only after registration succeeds.
4. Cleanup removes the widget, restores terminal settings and the original renderer by identity, writes alternate-screen leave once, and remains safe when a later renderer wrapper exists.
5. `/tui` toggles in interactive mode, rejects non-TUI modes clearly, and session shutdown cleans an active layout.
6. Full tests, strict manual typecheck, and a detached-tmux real-PTY smoke cover activation, streaming, resize, `/claudify`, deactivation, reload, and exit against the local checkout.
7. Long output is bounded to the transcript viewport; Page Up reveals earlier lines, Page Down returns to the live bottom, editor/footer rows stay pinned, streaming follows only at the bottom, and inactive/custom-focus input remains untouched.
8. SGR wheel input moves the same viewport while the ordinary editor is focused; activation and every cleanup path balance the captured mouse-mode enable/disable sequences without leaking wheel events into the editor.

## Validation

- `bun run test` passes all 16 suites, including the focused fullscreen suite.
- The strict manual TypeScript command from `AGENTS.md` passes.
- `npm pack --dry-run` includes `extensions/fullscreen-tui.ts`.
- Detached-tmux smoke passes activation, authenticated GPT-5.4 mini streaming, bounded 50-line output, Page Up/Page Down, scrolled-stream anchoring, submit-to-bottom, 100x30 → 80x24 resize, `/claudify` focus isolation, deactivation, `/reload`, Ctrl+D quit, and SIGTERM quit against the local checkout.
- A second detached-tmux smoke on Pi 0.83.0 passes raw SGR wheel-up/wheel-down scrolling, focus isolation inside `/claudify`, toggle-off restoration, and Ctrl+D cleanup against the local checkout. The user then confirmed physical trackpad scrolling in Orca terminal `term_a7404274-ed02-4282-b966-7320719ae32b`.
- Enter/leave transitions balance in every smoke path; normal-buffer repaints and quit cleanup preserve scrollback by emitting no `CSI 3J` after alternate-screen leave.

## Deliberate limits

This slice does not persist the toggle, add a setting row, replace Pi's transcript/editor/footer, or coordinate with undocumented alternate-screen ownership in unrelated extensions. Renderer restoration composes by object identity; an extension that mutates the terminal buffer independently remains outside Claudify's ownership.
