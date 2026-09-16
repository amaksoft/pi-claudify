# Claude Code v2.1.266 Markdown rendering capture

Date: 2026-09-10
Status: captured; profile controls and low-risk conformance implemented

## Method

Claude Code, vanilla Pi, and Pi + claudify rendered the exact same file-backed
Markdown fixture in 130×85 tmux panes. Environment: `TERM=xterm-256color`,
`COLORTERM=truecolor`, `COLORFGBG=15;0`. Raw SGR captured with
`tmux capture-pane -e -p`.

Fixture covers H1/H2/H3, bold/italic/bold-italic/strike, inline code, named/raw
links, blockquote, nested ordered/unordered lists, horizontal rule, aligned
table, fenced TypeScript/JSON/Bash, and a wrapping paragraph.

## Claude grammar and differences

| Surface | Claude Code | Current claudify | Delta |
| --- | --- | --- | --- |
| H1 | `⏺` + bold italic underline, default fg | `⏺` + Pi's native heading emphasis, default fg | italic remains a host-hook gap; never rewrite Markdown source |
| H2/H3 | two-space indent, bold, default fg | correct indent/marker stripping, gold fg | remove heading color |
| Bold/italic/strike | SGR 1 / 3 / 9 | same | none |
| Inline code | xterm 153, no background/backticks | lavender accent, no background/backticks | effectively matched |
| Named/raw links | xterm 94 + OSC-8; URL hidden for named link | underline/theme blue; named URL shown in parentheses | link post-processing needed |
| Blockquote | dim `▎`, italic body | muted `│`, italic body | glyph/style delta |
| List markers | default fg | accent lavender | use default fg in Claude mode |
| Horizontal rule | literal `---` | viewport-width `─` rule | replace rendered rule in Claude mode |
| Tables | box table, numeric `---:` column right-aligned | box table, numeric column left-aligned | Pi table alignment gap |
| Fenced code markers | hidden | visible dim ```lang / ``` | hide fence rows |
| Code indentation | two columns | roughly four after Pi + transcript indent | dedent fenced body |
| TS keyword/type | ANSI blue 34 | Pi theme truecolor | Claude syntax palette differs |
| variable/property | ANSI cyan 36 | Pi theme truecolor | differs |
| function | ANSI yellow 33 | Pi theme truecolor | differs |
| string | ANSI red 31 | Pi theme truecolor | differs |
| number | ANSI green 32 | Pi theme truecolor | differs |
| wrapped paragraph | two-space continuation; styles survive | same continuation; styles survive | matched |

## Color capture cross-reference

General dark palette and tool statuses are recorded in
`2026-09-10-cc-dark-palette.md`. Inline code xterm 153 matches claudify's current
Claude accent closely. Heading/list/syntax differences come from Pi's Markdown
theme, not message-chrome spacing.

## Implemented controls

- `colorSource: "claude" | "theme"` selects captured Claude semantic colors or
  the active Pi theme for Markdown, accent-linked surfaces, the default user
  message box, and Spinner shimmer. Explicit accent/box controls still win;
  tool chrome and diff palette remain independent because they also alter grammar.
- `markdownStyle: "claude" | "pi"` independently selects transcript grammar.
- Both are immediate-commit rows in `/claudify` → Theme and default to Claude.
- Captured values live in `extensions/claude-palette.ts`; claudify does not ship
  or select an application theme.

Claude Markdown mode now hides fence rows, removes the two excess fenced-body
indent columns, renders a literal `---`, uses `▎` for blockquotes without
altering table pipes, and supplies captured heading/list/inline-code/link colors
without mutating Pi's application theme. It deliberately does not rewrite H1
source to force italic because that changes closing hashes, escapes, emphasis,
links, and inline-code semantics. Pi mode bypasses these grammar changes. Current
Pi already emits OSC-8 named links without a visible `(url)` suffix; a regression
test pins that host behavior.

## Remaining parser-level work

1. Apply Claude's syntax-token palette without replacing Pi's parser/highlighter.
2. Treat table alignment separately; it likely needs a Pi Markdown/parser fix
   rather than fragile rendered-string surgery.

Every step needs fixture snapshots at narrow and wide widths. Do not replace
Pi's Markdown parser wholesale: emphasis, strike, table borders, wrapping, and
most syntax tokenization are already correct.
