# Optional Claude visual shell: themes, banner, prompt and footer metrics

Date: 2026-09-08
Status: implemented
Reference: local `cc-ui-fork` at `dbc0e83` (fork-only banner fixes included)

## Default policy

The package promises Claude UX by default and explicit opt-outs:

- startup banner: `onboarding` (full framed panel on new version/project,
  condensed thereafter), with `off` and `always` alternatives;
- banner frame: on; off selects the borderless condensed form;
- prompt pointer: on, unless another extension already owns the custom editor;
- Claude footer: on; provider quota, session cost, active-agent time and prompt
  count are on, with independent opt-outs; legacy wall-clock session age remains
  available through `footerTimeMode: "wall"`;
- MCP result output: hidden, matching the existing live capture;
- Pi's `hideThinkingBlock` remains the authority for thinking visibility;
  claudify only controls the hidden label.

## Theme ownership

The six `claude-code-*` themes are ordinary Pi theme assets, selected through
Pi's native theme setting. There is no second theme store or picker.

When a bundled theme is active and a claudify color setting is absent, the theme
owns the base accent and tool colors. Explicit `accentColor` or `toolChrome`
values intentionally override only their named surfaces. Diff grammar remains
Claude-unified regardless of active theme; only an explicit `diffPalette:
"theme"` opts into theme-derived colors and the legacy split layout. This keeps
theme selection from silently changing transcript structure.

The copied MIT theme assets retain their source attribution in `theme/LICENSE`.
Current-Pi-required `scrollbarTrack` was added to all six assets.

## Banner

The fork's corrected final behavior is used:

- Pi's six-row mark only; the optional Claude `✻` brand mode was deliberately
  rejected because `✻` already identifies spinner/worked activity;
- responsive wide, boxed, compact and plain layouts;
- onboarding state bounded to 50 projects and written atomically;
- `off` does not consume the one-shot onboarding state;
- frame/mode are read at render time, so Hub changes reflect live.

## Prompt pointer

`PromptEditor` extends Pi's `CustomEditor`, preserving application shortcuts,
paste and Bash mode. It reserves two columns and paints `❯ ` into the first
content row. Installation is conflict-safe: when another extension owns the
editor factory, claudify warns and leaves it untouched. Disabling restores the
default only if claudify still owns the active factory.

## Footer metrics

Session cost and prompt/time metrics extend the existing claudify footer; they
do not replace context or provider-quota segments. Prompt count and completed
foreground-agent spans are rebuilt from the active branch. Active time advances
from `agent_start` through `agent_settled`, includes foreground subagent waits,
does not multiply parallel child time, and pauses while the parent session is
idle. Live spans use a monotonic clock. Versioned start/completion journals are
stored as TUI-only custom entries; completion records are associated with their
terminal visible entry so reload, resume, tree navigation, and forks retain
branch-correct totals. Same-process reload continuity uses a bounded process-local
handoff rather than trusting persisted wall-clock markers. Only provider-reported
cost is counted.

## Tests and live verification

- Six themes define every required current-Pi token and are package-discovered.
- Bundled-theme default ownership and explicit accent override are tested.
- Banner widths 8–120, framed/borderless/off transitions, cache keys and Pi mark.
- Prompt pointer rendering, minimum padding, live opt-out and foreign-editor
  conflict behavior.
- Footer defaults, opt-outs, resumed cost/time/prompt accumulation.
- Live Pi 0.85 fullscreen smoke: native bundled theme, framed Pi banner,
  `❯` prompt, existing footer plus `$0.00 · 32s · 1 prompt`.
