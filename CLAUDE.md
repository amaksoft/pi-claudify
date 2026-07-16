# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. `AGENTS.md` is a symlink to this file, so any tool that reads `AGENTS.md` gets the same guidance.

## What this is

`@owlburtoe/pi-claudify` is a **pi extension** (for [pi](https://github.com/earendil-works/pi), an agent CLI) that re-renders pi's transcript to match Claude Code's TUI — tool rows, diffs, spinner, message chrome. It ships raw TypeScript that pi loads at runtime; there is **no build step and no compiled output**.

**The one rule that drives the codebase: capture, do not guess.** Every rendering detail is recorded from a live Claude Code session and written down in `docs/plans/` *before* code changes, and a test asserts the capture. When you're implementing or changing how something renders, find or create the capture in `docs/plans/` first; don't invent Claude Code's behavior from memory. `CONTEXT.md` is the domain glossary (Hub, Section, Picker, Spinner/Worked verbs) — read it before touching the settings screen.

## Commands

```bash
bun run test                       # full suite (15 assembled-render/handler suites)
bun scripts/test-claudify-hub.ts   # run one suite directly
```

There is **no lint/format tooling and no `tsconfig.json`**. Typecheck is a manual, explicit invocation (pi loads `.ts` via bun, so nothing else type-checks the code — run this before declaring work done):

```bash
npx tsc --noEmit --strict --skipLibCheck --allowImportingTsExtensions \
  --moduleResolution bundler --module esnext --target esnext --types node \
  extensions/index.ts extensions/claudify-screen.ts extensions/spinner.ts extensions/message-chrome.ts
```

**Do not launch an interactive pi session to verify changes** — pi hangs forever under a headless pseudo-terminal. Behavior is verified through the assembled-render/handler tests plus reasoned mechanism, as every suite does.

Git remote is **`forgejo`** (a `github` mirror also exists); there is no `origin`.

## Architecture

The extension has two entry points declared in `package.json` `pi.extensions`: `extensions/index.ts` and `extensions/spinner.ts`.

- **`extensions/index.ts`** (large) — the core. It monkey-patches pi's tool/message/container rendering, implements the diff renderer and the read-only-tool aggregation, wires OpenAI/MCP tool rows, and registers the single `/claudify` command. Most render logic lives here; the other `extensions/*.ts` are focused modules it imports.
- **`extensions/claudify-screen.ts`** — `ClaudifyScreen`, the full-height `/claudify` TUI panel (a Hub of Sections of setting rows). It renders **inline** (not an overlay), framing itself like pi's Extensions Manager: an accent rule top/bottom, a `Claudify` title, the body, height-fill padding, and a footer pinned above the closing rule. `render()` reads `tui.terminal?.rows` to fill to `rows − PANEL_HEIGHT_RESERVE`, degrading to natural height when no terminal size is present (the tests construct a `tui` without `.terminal`). Row kinds: immediate-commit (boolean/enum/number), **text** (inline input sub-mode), **picker** (live-preview candidate list), and **verbs** (list editor). Guard against `mode !== "tui"`. Constructor callbacks: `onClose`, `onSettingChange`, `onSettingPreview`, and `onNotify` (wired in `index.ts` to `ctx.ui.notify`) — the last surfaces write failures, verb-add rejections, truncation, and `.bak` recovery as an inline footer notice + toast instead of failing silently.
- **`extensions/settings.ts`** — `readSettings()` / `writeSettingsKey()`. Settings are **user-scope only** (`~/.pi/settings.json`); the project file is ignored (ADR 0004). Writes are atomic (tmp+rename). `writeSettingsKey` returns a `SettingsWriteResult` (`{ success, backupCreated }`) rather than swallowing errors — callers must surface a failed write. `normalizeAliases` maps legacy 1.x keys on both read and write (`spinnerVerbColor`→`spinnerColor`, `toolBackground: "border"`→`"outlines"`) — **keep it intact so 1.x settings keep loading.**
- **`extensions/footer.ts`** — the Claude Code-style statusline footer (`dir │ ⎇ branch │ model │ Ctx: N% ▓░ │ Effort: level`, ported byte-for-byte from Berto's `~/.claude/statusline-command.sh` grammar) installed via pi's first-class `ctx.ui.setFooter`, plus `patchEditorBorderColor()`, which pins pi's input-box border to gray at every thinking level (Claude Code never tints it; bash mode's recolor is kept). The border wrapper re-checks settings **when the colorizer runs** (every render), because pi reassigns `editor.borderColor` from `Theme.getThinkingBorderColor` on its own events, so instance patches don't hold. Capture/decisions: `docs/plans/2026-07-16-cc-input-box-footer.md`. Deliberate omission: the script's Usage/Reset segment (Claude subscription rate limits) has no pi data source.
- **`extensions/spinner.ts`** — patches pi's `Loader` (glyphs, verb pool, colors). Reads settings each 250ms tick behind a 1s TTL plus a cross-module bust global (`bustSpinnerSettingsCache()`).
- **`extensions/message-chrome.ts`** — assistant/thinking prefixes, spacing, and the **worked-verb** pool + `formatWorkedLine`.
- **`extensions/inspection-summary.ts`, `mutation-summary.ts`** — the gerund/past-tense summary strings for aggregated read-only tools and for write/edit results.

### Conventions that bite

- **Live-reflection contract.** A settings control that persists but does not change the running transcript is a bug, not a feature. When a row commits, `commitSetting` → `writeSettingsKey` + `onSettingChange(key, value)` (wired in `index.ts`), which must apply the change live — bust the spinner cache for spinner/verb keys, call `refreshDiffPalette` for diff/theme keys, etc. Only expose a setting once a renderer actually consumes it.
- **`theme.fg(key, …)` throws on a color key the active theme doesn't define.** Never pass an arbitrary/user-supplied color key to `theme.fg` directly — route it through the `themedByKey` helper (claudify-screen) or `safeFgAnsi` (index.ts), which fall back instead of crashing the render.
- **Pickers** preview live *without* persisting: highlighting installs an in-memory override (spinner globals / `diffThemePreview`) distinct from commit; Enter commits, Esc/close clears the override. Don't preview by writing the file.
- **Publishing.** `package.json` `files` must list **every** `extensions/*.ts` that `index.ts` imports (currently incl. `claudify-screen.ts`, `footer.ts`, and `settings.ts`) — the package ships source, so a missing file silently breaks it on install. To publish: from a checkout at the target version, run bare `npm publish` (never `npm publish <name>@<version>` — that re-publishes an existing registry version and errors). Dry-run first with `npm publish --dry-run`.

Architectural decisions are in `docs/adr/`; live-capture specs are in `docs/plans/`; session handoffs in `docs/handoff/`.

### Plane issue auto-close (CI)

`.forgejo/workflows/plane-sync.yml` (+ `.forgejo/scripts/close-plane-issues.mjs`) closes Plane work items on PR merge. Put the closing reference as **plain prose** in the PR **body** — `Closes CLFY-14` (also `Fixes`/`Resolves`); references in commit messages are not read, because Forgejo's merge commit doesn't carry the PR body. References inside code spans/backticks are **ignored** (so a PR documenting the syntax doesn't fire) — `scripts/test-plane-refs.ts` guards this. Needs a repo-level `PLANE_PROJECT_ID` secret; the other three Plane secrets are inherited from the owlburtoe user.
