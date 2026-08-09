# Hermes — Insert → Code Block: Design

**Date:** 2026-08-09
**Status:** Approved design, pending implementation plan
**Release:** v0.7.0 (the release's remaining bullet)

## Overview

Inserting a fenced code block means remembering three backticks and a language
tag, and getting the language tag right matters more since v0.7's highlighting
— a misspelt one silently renders plain. This adds a menu route that writes the
fence, names the language, and leaves the cursor where you type.

## Decisions

| Question | Decision |
|---|---|
| Picker form | An Insert submenu, not a dialog |
| Language list | Curated in `menu.go`, ~14 entries |
| Accelerator | None |
| Where the cursor lands | Inside the fence, on the empty line |
| Text is selected | Wrap it in the fence |

**A submenu, not a modal.** The chart builder is a dialog because a Vega-Lite
spec is genuinely hard to hand-write. A code fence is a delimiter and a
language name; the only part carrying value is choosing the language, and a
submenu does that natively, needs no new UI, and reads like the Heading and
PDF Orientation submenus already do.

**A curated list rather than all ~150.** `@codemirror/language-data` knows
about 150 languages, which is unusable as a menu and would need a filter field
— that is the dialog this design rejected. The list below is a one-line edit in
`menu.go` when it needs to change.

## The menu

`Insert → Code Block`, with plain items in this order:

Python, R, Julia, Fortran, C++, JavaScript, Go, Rust, Shell, SQL, JSON, YAML,
LaTeX, and **Plain text**.

Each emits `menu:insert-code` carrying the language token it will write into
the fence (`python`, `c++`, `latex`, …). Plain text carries an empty token and
produces a fence with no language after it.

**Every token was checked to resolve.** `loadGrammar` matches a fence's
language against `language-data` by name or alias, so a token that does not
resolve inserts a block that silently never colours. All thirteen language
tokens above were run through that lookup and matched. MATLAB was considered
and dropped for exactly this reason: no grammar ships for it, so the menu would
have offered a language that renders plain.

No accelerators — an invented chord cannot be checked against every macOS
binding, the same reasoning as Insert → Chart… and Blockquote.

## Where the cursor lands

This is the part that decides whether the feature is worth having.

`Editor.insertBlockAtCursor` leaves the cursor *after* the text it inserted.
Used as-is, the command would drop a fence and strand the author below it,
needing two arrow keys to get inside — barely better than typing the backticks.

So the editor gains a way to insert a block and place the cursor within it. The
inserted text is:

````text
```python
⟨cursor⟩
```
````

— the opening fence, an empty line, the closing fence, with the selection
collapsed onto that empty line.

## A selection is wrapped, not destroyed

`insertBlockAtCursor` is built on `view.state.replaceSelection`, so with text
selected it **deletes that text** and puts the block in its place. For a code
block the obviously-correct behaviour is the opposite: wrap the selection in
the fence, which is what an author selecting three lines and reaching for this
menu means.

So the command has two shapes:

| State | Result |
|---|---|
| Cursor, no selection | Empty fence, cursor on the middle line |
| Text selected | That text inside the fence, selection preserved |

The wrap case reuses the selected text verbatim, including its line breaks; no
re-indentation, no trimming. An author who selected a partial line gets exactly
what they selected.

### A related hazard, deliberately out of scope

**Insert → Chart… destroys a selection today**, for the same reason: it also
routes through `insertBlockAtCursor`. Select a paragraph, insert a chart, and
the paragraph is gone with no undo prompt. That is a pre-existing bug in
another feature, not something this design should quietly change while passing
by, but it should be recorded so it is not rediscovered.

## Components

| File | Change |
|---|---|
| `menu.go` | The `Code Block` submenu, emitting `menu:insert-code` |
| `frontend/src/Editor.svelte` | Insert a block and place the cursor inside it |
| `frontend/src/App.svelte` | Handle the event, guarded like the other menu handlers |

`App.svelte`'s handler carries the same guards every menu handler has: refused
while the welcome pane is showing, and refused while the chart builder is open,
because menu events arrive from AppKit through Go's event bus and never touch
the DOM — a modal cannot intercept them.

## Error handling

| Situation | Result |
|---|---|
| Cursor mid-line | The fence starts on a fresh line, as `insertBlockAtCursor` already guarantees |
| Cursor inside an existing fence | Not prevented; nesting fences is the author's business, and guarding it would need the same syntax-tree work the format commands do for a different reason |
| Empty document | A fence at the top, cursor inside |

## Testing

`Editor.test.ts`, the two behaviours that make this worth building:

- with no selection, the cursor lands on the empty line *between* the fences,
  so typing goes into the block;
- with a selection, the selected text ends up inside the fence and is not lost.

`App.test.ts`:

- `menu:insert-code` reaches the editor and writes a fence carrying the
  language it was given;
- it is refused while the chart builder is open, matching the other handlers.

`menu.go` stays untested: it has no test file, AppKit menu construction is not
exercisable headlessly, and the language tokens' resolvability was verified
once, here, rather than pinned by a test that would only restate the list.

### What is not tested

That the submenu appears in the right place and reads correctly. Same limit as
every other menu item.

## Manual check

1. Insert → Code Block → Python with the cursor in prose: a fence appears on
   its own line, the cursor is inside it, and typing goes into the block.
2. The block colours as Python once typed into — both panes.
3. Select two lines of prose and insert a Shell block: the lines are inside the
   fence, not deleted.
4. Insert → Code Block → Plain text: a bare fence, no language, no colour.
5. With the chart builder open, the item does nothing — as with every other
   menu action.
