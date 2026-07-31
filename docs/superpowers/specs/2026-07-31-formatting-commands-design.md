# Hermes v0.4 — Editor Formatting Commands: Design

**Date:** 2026-07-31
**Status:** Architecture chosen (Option C), open decisions pending

## Overview

Select text in the editor and apply markdown formatting to it: put the cursor
on a line and make it a heading, select a block of lines and make them a list,
select a phrase and make it bold. The editor stays a plain markdown source
editor — this adds commands that rewrite the source, not a WYSIWYG layer.

## Why this is hand-rolled

Nothing off the shelf does it. `@codemirror/lang-markdown` exports exactly two
commands, `insertNewlineContinueMarkup` and `deleteMarkupBackward` (list
continuation on Enter and its matching backspace). Neither the core CodeMirror
packages nor the `codemirror` meta package offers toggle-bold, make-heading, or
anything comparable. No mature third-party package fills the gap for CM6.

The dependencies needed are already installed transitively (`@codemirror/state`,
`view`, `commands`, `language`), so the feature adds no new supply chain. Any
direct imports should be promoted to explicit `package.json` dependencies rather
than relying on transitive resolution.

## Options considered

| Option | Verdict |
|---|---|
| A — Regex manipulation inline in `Editor.svelte` | Rejected: lives in a component, so untestable without component-test infrastructure this project does not have; blind to fenced code |
| B — Pure `StateCommand`s in `lib/`, regex detection | Viable but still blind to fenced code, leaving the chart-corruption case live |
| **C — Pure `StateCommand`s in `lib/`, hybrid detection** | **Chosen** |
| D — Third-party markdown-commands package | Rejected: nothing mature for CM6; poor trade for ~200 lines we can own and test |
| E — Replace the editor with a WYSIWYG component | Rejected: discards the markdown-source-of-truth model the preview and PDF export depend on, and collides with the citation pipeline |

## Chosen architecture (Option C)

### Two command families

Block and inline formatting are different operations and must not share a code
path. Conflating them is what produces `## ### Foo` and `**` inserted across a
line break.

- **Block commands** (headings, lists, blockquote) act on whole lines. A
  selection spanning several lines applies to each line. Applying a heading to
  a line that already has one *replaces* the marker rather than prepending.
- **Inline commands** (bold, italic, code, strikethrough) wrap a range and care
  about exact selection boundaries. Toggling off means locating and removing
  the surrounding delimiters.

Two primitives, `toggleBlockPrefix` and `toggleInlineWrap`, keep each simple.

### Placement and testability

Commands live in `frontend/src/lib/markdownCommands.ts` as pure `StateCommand`s
with no DOM or Svelte dependency. `Editor.svelte` is reduced to a thin
`runCommand(cmd)` passthrough. This mirrors the `citationFeedback.ts` extraction
from v0.3, and keeps the logic unit-testable.

Verified by probe: `@codemirror/lang-markdown`'s Lezer tree parses **fully
headlessly under Vitest with no DOM** (a 133-character test document parsed to
completion). Commands can therefore be developed test-first against a plain
`EditorState`.

### One transaction per command

Every command builds a single transaction via `state.changeByRange`. This buys
two things at no cost: one undo step per action, and multi-cursor support, since
`changeByRange` iterates every selection range natively. Selection must be
mapped through the changes so it survives the edit.

### Hybrid detection — and where the tree lies

The syntax tree is already maintained by `lang-markdown` for highlighting, so
querying it is free. Probe results confirm the node names are what the commands
need:

| Position | Resolves to |
|---|---|
| Inside `**bold**` | `StrongEmphasis < Paragraph` |
| A `## heading` line | `ATXHeading2` |
| A list line | `Paragraph < ListItem < BulletList` |
| Inside a ```` ```vega-lite ```` block | `CodeText < FencedCode` |

That last row matters most: **fenced code is reliably detectable**, so the worst
destructive case — formatting applied inside a chart spec, corrupting it — is
cleanly guardable.

The same probe found three places the tree misleads, all specific to Hermes.
These are the reason detection is hybrid rather than purely tree-driven:

1. **Frontmatter parses as a heading.** `bibliography: refs.bib` inside a `---`
   block resolves to `SetextHeading2`, because CommonMark reads text followed by
   `---` as a setext H2. The stock parser has no frontmatter concept. A
   tree-driven heading toggle would mangle the frontmatter block and silently
   break the bibliography. Needs an explicit guard, not tree logic.
2. **Citations parse as links.** `[@smith2020]` resolves to `Link`, since
   `[...]` looks like a link label. Inline commands near citations are reasoning
   about a node type that is lying to them.
3. **Math is invisible.** `$x^2$` is plain `Paragraph` — no node at all. The
   tree cannot report that a position is inside math, so it cannot protect
   KaTeX from a stray `*`.

So: use the tree for fenced-code guarding and inline mark detection; use
explicit line-start logic for frontmatter, headings, and list prefixes, where a
regex is both simpler and more accurate than walking the tree.

## Open decisions

These are taste calls that drive most of the logic and should be settled before
an implementation plan is written. Recommendations are proposals, not decisions.

### 1. Toggle semantics

- Does applying H2 to an existing H2 remove the heading, or do nothing?
  *Recommended: remove it — matches the muscle memory from every other editor.*
- Does bold on a partially-bold selection bold the remainder, or unbold
  everything? *Recommended: bold the remainder; "make it more formatted" is
  almost always the intent.*
- What happens when a selection spans a mix of list and non-list lines?
  *Recommended: convert everything to a list.*

### 2. Shortcut ownership — note the trap

Accelerators can be owned by the Go menu **or** by a CodeMirror keymap, never
both. A shortcut registered in `menu.go` is intercepted by AppKit before the
webview sees it, so a CodeMirror binding for the same chord would never fire.

*Recommended: follow the existing `menu:insert-citation` precedent — accelerators
live in `menu.go` and emit events the frontend handles.* This requires a focus
guard, because menu accelerators fire regardless of focus: without one, ⌘B while
the welcome pane is up would mutate a hidden editor.

### 3. UI surface

The toolbar already carries four buttons plus the traffic-light inset, so a
full set of format buttons will not fit that row. A Format menu costs no pixels
but is less discoverable than a visible formatting bar. This interacts with the
other v0.4 item about the welcome overlay covering the toolbar.

## Out of scope

- WYSIWYG or rich-text editing; the source stays the source of truth.
- Table formatting helpers.
- Reformatting or prettifying existing markdown.
