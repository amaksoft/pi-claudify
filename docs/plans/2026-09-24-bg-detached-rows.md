# Detached background shell rows — live capture and grammar

Date: 2026-09-24
Status: implemented (`bgDetachedEnabled`, `bgPresentation` compat)
Reference: engine contract `pi-bg-shell/docs/completion-contract.md`

## Capture method

Ground truth from two sources:

1. **Claude Code's own running row** (prior capture, `2026-09-08-shell-command-ux.md`):
   `⎿ $ for i in …; sleep 1; done (6s · 7 lines)` plus the
   `(ctrl+b ctrl+b (twice) to run in background)` hint. Collapsed:
   `Ran 1 shell command` — no output, no command text.
2. **Live pi smoke this date**: pi + `@owlburtoe/pi-bg-shell` + claudify in a
   detached tmux session, `sleep 30` backgrounded. Expanded transcript shows:

```text
⎿  Running in background · job 140bca
   log: /tmp/pi-tmux-bash/.../pi-background.@725.8dfd7179.out
⏺ Started sleep 30 in background window slicerow.
```

Collapsed aggregate is unchanged (`Ran 1 shell command`) — this matches the
Claude Code capture, which likewise hides backgroundness when collapsed.

## Implemented grammar

Detached results (engine `details.outcome` of `detached-background` or
`timed-out-background`, or — for launch results that carry
`details: undefined` — the stable `job_id:`/`log_path:` text markers) render:

- settled-shaped but non-terminal: no `Done`, no duration line, no output preview
- `Running in background` in warning color, `· job <id>` muted
- second dim line with the spool path when known
- amber status held (`setStatus(ctx, "pending")`), blink stopped
- kill-switch: `bgPresentation` compat flag off (or `bgDetachedEnabled()` false)
  restores settled rendering

Deliberately not changed: collapsed aggregates (parity with the CC capture),
`tool-record.ts` phases (detached stays `settled`, so inspection grouping,
counts, and click-to-expand behave identically), row ownership gates (function
renderers never tripped the `renderShell === "self"` gate — verified live).

## Follow-up: footer (same date, slice 2)

- `Bg: N` segment from the stable `backgroundBashTmuxCommands` status key;
  the consumed key is removed from the dim passthrough lines (fail-open:
  unparseable values stay passthrough, setting `footerBgJobs: false` restores
  old behavior).
- `\u2190 N done` flash replaces the slot for 6s on count decrease, including
  the real engine path where the key is cleared outright (first implementation
  only flashed on numeric decrease — caught live, covered by test).
- Verified live in TUI: `Bg: 1` while running, `\u2190 1 done` after completion.

## Follow-up: management rows (same date, slice 3)

`tmux`/`bg` route through the generic OpenAI-style renderer (not core
overrides, not task names) — verified, no discovery change needed. One
cosmetic fix: the call summary defaulted to the tool name (`Tmux(Tmux)`).
`tmux`/`bg` now summarize to action + target (`Tmux(list)`, `Tmux(peek @123)`,
`kill a1b2c3`), covered in `scripts/test-bg-detached.ts`, verified live.
No row-hiding needed: no bg widget exists to duplicate.

## Follow-up: running hint + agency wording (same date)

User session showed two gaps: (1) no hotkey hint anywhere under claudify
(the hint lived only in the engine's overridden call renderer); (2) after a
Ctrl+B detach the model "corrected" parameters and killed the job three times
— the result text never established user agency.
- Running rows now append `(ctrl+b to background)` when a background-capable
  bash is registered (detected via `run_in_background` in the tool schema,
  refreshed with ownership; absent engine = no hint). Verified live.
- Engine detach text now opens with user agency plus do-not-kill/do-not-rerun
  instruction; covered by a live Ctrl+B test asserting the wording.
