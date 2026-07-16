# Claude Code input box + statusline footer — capture & design

Date: 2026-07-16
Status: captured, driving the `footer.ts` implementation

## Goal

Restyle pi's bottom-of-screen UI to match what Berto sees in Claude Code:

1. **Input box border stays gray at all times** — pi tints the editor border by thinking
   level (`Theme.getThinkingBorderColor`), Claude Code never does.
2. **Footer becomes a Claude Code-style statusline** — the one produced by Berto's own
   `~/.claude/statusline-command.sh`: `dir │ ⎇ branch │ model │ Ctx: N% │ Usage: N%
   … → Reset: time`, one configurable color. Context follows the active model's window;
   authenticated quota windows follow the active model's provider.

## Capture method

`claude` v2.1.211, dark theme, launched in a detached tmux session
(`tmux new-session -d -x 100 -y 32`, `env -u CLAUDECODE`), captured with
`tmux capture-pane -e`. Raw frames were taken in five states: idle, bash mode (`!`),
and the three `shift+tab` permission-mode cycles (manual → accept-edits → plan).

> **Caveat:** tmux advertised 256 colors, so truecolor output is downconverted in the
> captures (e.g. the statusline's `#FF9200` shows as `38;5;214`). The border color `244`
> is what Claude Code emitted under that terminal; the authoritative statusline colors
> come from the script source, which always emits truecolor for the single color.

## Captured frames (annotated, colors as `[SGR]`)

Idle:

```
[38;5;244]──────────────────────────────────────────────────  top rule, fg 244
[39]❯                                                         prompt, default fg
[38;5;244]──────────────────────────────────────────────────  bottom rule, fg 244
[39]  [38;5;214]claudify │ ⎇ master │ Fable 5 │ Ctx: 0% │ Usage: 10% ▓[38;5;208]┃[38;5;214]░░░░░░░░ → Reset: 06:40 PM[39]
  [38;5;220]⏵⏵ auto mode on[38;5;246] (shift+tab to cycle) · ← for agents[39]
```

Bash mode (`!` typed):

```
[38;5;211]──────────────────────────────────────────────────  rules turn 211 (pink)
! [39]                                                        prompt becomes "! " in 211
[38;5;211]──────────────────────────────────────────────────
[39]  [38;5;211]! for shell mode[39]
```

Permission-mode cycles (`shift+tab` ×3): the **border stays 244 in every mode**; only
the hint line changes color/wording — `⏸ manual mode on` (246), `⏵⏵ accept edits on`
(147), `⏸ plan mode on` (73).

### Findings

- The input box is a **top rule + bottom rule only** (no side borders) — same shape as
  pi's `Editor`, which draws exactly the same two rules.
- The border is **gray (256-color 244) in every permission mode and at every effort
  level**. Claude Code has no concept of effort-tinted borders at all (effort appears
  only in the banner text, "Fable 5 with medium effort").
- The **only** state that recolors the border is bash mode: rules, prompt and hint all
  turn 211 (pink). This is authentic Claude Code behavior and is kept in pi (pi's
  `bashMode` theme key serves the same role).
- The statusline renders **below the bottom rule, indented 2 spaces**, entirely in the
  configured single color; only the pace marker `┃` carries its own tier color.

## The statusline itself (source of truth: the script, not the capture)

Berto's `~/.claude/statusline-command.sh` + `~/.claude/statusline-config.txt`. Current
config: `COLOR_MODE=singleColor`, `SINGLE_COLOR=#FF9200`, every segment enabled.

Script grammar (segments joined by ` │ ` in GRAY, which the single-color mode paints
like everything else):

| Segment | Format | Color (colored mode) |
|---|---|---|
| Directory | `basename $PWD` | blue `\e[0;34m` |
| Branch | `⎇ {branch}` (omitted outside a repo) | green `\e[0;32m` |
| Model | display name, e.g. `Fable 5` | yellow `\e[0;33m` |
| Context | `Ctx: {n}%` of the window | cyan ≤50 / yellow ≤75 / `38;5;160` >75 |
| Usage | `Usage: {n}% ▓▓░░░░░░░░ → Reset: {t}` | 10-level green→red gradient |

Color modes: `colored` (per-segment palette above), `singleColor` (one truecolor hex for
everything), `monochrome` (no SGR at all).

Bar grammar: 10 blocks, `▓` filled / `░` empty, `filled = round(pct/10)`.

## Provider quota-source verification

Pi 0.80.7's extension context exposes the active `ctx.model`,
`ctx.getContextUsage()`, and `ctx.modelRegistry`. The registry's
`getApiKeyForProvider(provider)` returns pi's refreshed request credential, while
`isUsingOAuth(model)` distinguishes subscription auth from API-key auth. Quota data is
not part of `setFooter`; the footer must fetch it asynchronously and request a rerender.

The authenticated provider responses used by existing usage apps were verified against
the current endpoint shapes before implementation:

| Active provider | Source | Windows rendered |
|---|---|---|
| Anthropic OAuth | `GET https://api.anthropic.com/api/oauth/usage`; `five_hour` and `seven_day` objects contain `utilization` plus RFC 3339 `resets_at` | `Usage` (five-hour) then `Week` (seven-day) |
| OpenAI Codex OAuth | `GET https://chatgpt.com/backend-api/wham/usage`; `rate_limit.secondary_window` contains `used_percent` plus epoch `reset_at` | `Week` only; the current OpenAI account does not expose a five-hour window for this footer |

Both endpoints are provider-owned and currently undocumented. Failures, schema changes,
API-key auth, and unsupported providers degrade without crashing or inventing quota.
The footer shows `Usage: ~` / `Week: ~` while a supported OAuth source is loading or
unavailable. Responses are cached in memory for 60 seconds to avoid polling on every
render.

Security boundary: claudify obtains OAuth access only through pi's model registry. It
never reads `~/.pi/agent/auth.json` directly, persists or logs a credential, puts a token
in a cache key, or writes provider responses to disk. The in-memory cache contains only
validated percentages and reset timestamps.

Approved compact grammar:

- Anthropic: `dir │ ⎇ branch │ model │ Ctx: N% │ Usage: N% [bar] → Reset: t │ Week: N% [bar] → Reset: t`
- OpenAI: `dir │ ⎇ branch │ model │ Ctx: N% │ Week: N% [bar] → Reset: t`

The bar belongs to each quota window, not to `Ctx`. Model-family-specific weekly buckets
such as `seven_day_opus` are deliberately omitted from this compact first version.

## Mapping onto pi — decisions

| Decision | Rationale |
|---|---|
| Footer replaced via `ctx.ui.setFooter(factory)` | First-class extension API; no monkey-patch. `setFooter(undefined)` restores pi's stock footer, so a `footerStyle: "pi"` escape hatch is free. |
| Segments: `dir │ ⎇ branch │ model │ Ctx: N% │ Usage/Week … → Reset` | **Model** comes live from the session (updates when ctrl+p / ctrl+l changes it). **Context** uses `ctx.getContextUsage()` — percent of the current model's window. **Usage** chooses the OAuth quota source from `ctx.model.provider`; changing provider/model changes the displayed windows. There is no `Effort` segment because the captured script does not render one. |
| Quota fetch is lazy, in-memory, and provider-scoped | Footer render is synchronous. A supported OAuth model returns placeholders immediately, starts at most one fetch for that provider, caches validated non-sensitive values for 60 seconds, then requests a rerender. Provider switches and footer disposal abort obsolete requests; there are no polling timers or persistent cache. |
| Extension `setStatus` lines preserved | pi's stock footer renders other extensions' statuses; the replacement appends them (dim) after the statusline so installing claudify doesn't eat them. |
| Border pinned by wrapping `Theme.prototype.getThinkingBorderColor` | pi reassigns `editor.borderColor` from this method on ~11 event sites (`interactive-mode.js updateEditorBorderColor()`), so patching the instance doesn't hold. The wrapper returns a colorizer that checks the setting **when called** (every render), so toggling the setting reflects without waiting for a thinking-level event. Gray = theme `borderMuted` (adaptive, matches CC's 244-gray role) with a safe fallback. |
| `getBashModeBorderColor` untouched | CC also recolors bash mode (211). Authentic. |
| Colors are fixed ANSI, mirroring the script byte-for-byte | The script's palette is theme-independent; the port keeps its exact SGR sequences (classic 16-color for segments, truecolor for single-color mode, 256-color for the >75% context tier). |

## New settings (user scope, `~/.pi/settings.json`)

| Key | Values | Default | Notes |
|---|---|---|---|
| `footerStyle` | `claude` \| `pi` | `claude` | `pi` restores the stock footer live |
| `editorBorder` | `gray` \| `thinking` | `gray` | `thinking` restores pi's per-level tinting |
| `footerColorMode` | `colored` \| `single` \| `monochrome` | `colored` | script's own default |
| `footerColor` | `#RRGGBB` | `#FF9200` | used by `single` mode; text row, validated |
| `footerUsageBar` | boolean | `true` | appends the 10-block bar to each available quota window; legacy `footerContextBar` is normalized to this key |

All five live in a new **Footer** section on the Claudify screen. Live-reflection
contract: `footerStyle` re-runs the `setFooter` install/uninstall; every other key is
read at render time, so a commit + `requestRender` is enough. `footerColor` is the
screen's first non-message text row; empty submit cancels (same rule as prefixes),
invalid hex is rejected with a footer notice.
