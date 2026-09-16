# Claude Code v2.1.266 edit syntax highlighting

Date: 2026-09-10
Status: captured, implemented, and verified in the normal Pi package runtime

## Method

A live Claude Code session edited TypeScript, JSON, and Python files in a
130×100 tmux PTY under `TERM=xterm-256color`, `COLORTERM=truecolor`, and
`COLORFGBG=15;0`. Raw SGR output was captured from the completed Edit rows.

Captures:

- Claude Code: `/tmp/cc-edit-syntax.raw`
- Pi + claudify: `/tmp/pi-edit-syntax-shiki.raw`

## Observed behavior

Claude applies language-aware token highlighting to context and added rows while
keeping removal text plain. Syntax foreground is layered inside the diff row's
background; changed words receive a brighter add/delete background.

Observed examples:

- JSON keys: xterm 148
- JSON boolean on changed-add background: xterm 197 / background 28
- Python strings: xterm 186
- Python numbers: xterm 141
- Python function names: xterm 148
- unchanged/default code: xterm 231
- delete gutter/background: xterm 167 / 52 (`#d75f5f` / `#5f0000`)
- add gutter/background: xterm 77 / 22 (`#5fd75f` / `#005f00`)
- changed addition background: xterm 28 (`#008700`)
- deleted rows use one uniform background; there is no brighter deleted-token region

## Implementation decision

Do not implement a lexer. Claudify uses Shiki's Monokai grammar/theme pipeline
for TypeScript, JSON, Python, Bash, and the other mapped languages. Monokai's
semantic colors match the captured Claude classes: `#66d9ef` keyword,
`#a6e22e` function/property, `#e6db74` string, `#ae81ff` number, and `#f92672`
boolean/operator.

Pi's extension sandbox could not resolve the hidden dynamic imports used by
`@shikijs/cli`; this previously caused live packaged sessions to silently fall
back to plain text even though direct unit tests highlighted correctly. The
extension now statically declares `@shikijs/themes/monokai` and its supported
`@shikijs/langs/*` grammar modules, initializes Shiki lazily on the first diff,
and serializes Shiki's returned tokens to SGR. Shiki still owns language parsing,
scopes, and token colors. The debug fallback reports failures under
`PI_CLAUDIFY_DEBUG=1`.

`diffSyntaxHighlighting` controls whether the Shiki stage runs. It defaults to
`true` and is exposed as `/claudify` → Diffs → Syntax highlighting. Turning it
off preserves unified layout, line numbers, add/delete foregrounds, line
backgrounds, changed-word backgrounds, wrapping, and persistence; only language
token colors are removed. The setting applies to both Edit diff hunks and Write
file listings.

The normal-package recapture confirms TypeScript additions contain the same
Monokai semantic colors as Claude and no runtime import error. Claude-mode edit
rendering also uses one aggregate full-file diff with real line numbers/context,
`Added N lines, removed N lines` grammar, normal-weight gutters, full-width fresh
xterm-equivalent row backgrounds, changed-word emphasis only on additions, and
neutral punctuation/operator foregrounds.
