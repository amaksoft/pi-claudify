# pi-claudify

Makes pi's transcript render the way Claude Code's does, because that rendering is what makes an agent feel trustworthy. Rendering details are captured live from Claude Code, never invented.

## Language

**Claudify screen**:
The full-screen keyboard-driven overlay opened by the bare `/claudify` command. In 2.0.0 it is the only way to change this package's settings at runtime; the `/cc-*` commands are gone.
_Avoid_: settings dialog, config panel, /cc screens

**Hub**:
The Claudify screen's top level: a list of Sections. Enter drills into a Section, esc from the Hub closes the screen.
_Avoid_: main menu, root screen

**Section**:
One drill-in page of the Claudify screen owning a cohesive group of settings (Theme, Diffs, Spinner, Messages, Tool output). Esc returns to the Hub.
_Avoid_: tab, category, submenu

**Picker**:
A row on a Section that chooses from a list of visual candidates (spinner color, diff theme). Moving the highlight previews the candidate live; enter commits it, esc restores what was set before. All other rows (booleans, enums, numbers) commit and persist the moment they change.
_Avoid_: selector, dropdown

**Project override** _(retired by ADR 0004)_:
2.0.0 ignores the project `.pi/settings.json` entirely; every setting of this extension is user-scoped in `~/.pi/settings.json`, so no override, badge, or provenance exists. The term survives only for reading ADR 0003's history.
_Avoid_: local settings, workspace settings

**Spinner verbs**:
The present-tense pool shown while a turn is running (`✻ Cooking…`). Edited in the Spinner section under "While working".
_Avoid_: working verbs, loading verbs

**Worked verbs**:
The past-tense pool that names a finished turn (`✻ Cooked for 8s`). Lives with Spinner verbs in the Spinner section (labeled "After finishing") even though the worked line is rendered by message chrome; users experience both pools as one feature.
_Avoid_: completion verbs, done verbs

## Example dialogue

> **Dev:** Where do I change the spinner color now that /cc-spinner is gone?
> **Expert:** Open the Claudify screen with /claudify, pick the Spinner section from the Hub, and choose a theme key there. Esc backs you out to the Hub, esc again closes the screen.
