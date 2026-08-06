# Hermes — Collapsible Blocks: Design

**Date:** 2026-08-06
**Status:** Approved design, pending implementation plan

## Overview

Long `vega-lite` and code blocks make a paper hard to read in the editor. The
document should stay a single file, but those blocks should be foldable out of
the way until you want them.

**The feature already exists.** This design is about making it findable, and
fixing the one place it is visibly broken.

## The finding

Checked against the real editor configuration rather than assumed. `basicSetup`
already includes `foldGutter` and `foldKeymap`, and `@codemirror/lang-markdown`
supplies fold ranges for every Block node that is not a Document, heading or
list. Measured on a representative document:

| Block | Folds today | Effect |
|---|---|---|
| ` ```vega-lite ` | yes | keeps the fence line, hides the spec body |
| ` ```js ` and other fences | yes | same |
| Blockquote | yes | |
| Table | yes | |
| Heading | yes | hides its whole section to the next heading |
| List | no | |

On macOS, `foldKeymap` already binds **⌘⌥[** to fold the block at the cursor
and **⌘⌥]** to unfold it. Both work today. `foldAll` and `unfoldAll` are bound
only on `Ctrl-Alt-[` / `Ctrl-Alt-]`, which have no Mac equivalent — so on macOS
there is currently no way to fold everything at once.

So what is missing is not the mechanism. It is that nothing announces the
mechanism exists, and that folding looks wrong in the dark theme.

## What this changes

### The View menu

```
View
  ✓ Sync Scrolling
    Appearance            ▸
    ──────────────────────
    Fold Block            ⌘⌥[
    Unfold Block          ⌘⌥]
    ──────────────────────
    Fold All Code Blocks
    Unfold All
```

The first pair adds no capability — those chords already work. Listing them is
the entire point: a gutter arrow is the only affordance today, and on a wide
editor pane it is easy never to notice.

The second pair is new. **Neither gets an accelerator**, following the
precedent `menu.go` already sets for Blockquote — *"the obvious chords are not
worth guessing at, and the menu item is the discoverable route."* `⌘⌥[` and
`⌘⌥]` are safe to display because CodeMirror owns them and we are only
reflecting that; any chord invented for fold-all would be a guess that cannot
be verified against every macOS system binding.

### Fold All *Code Blocks*, not Fold All

CodeMirror ships `foldAll`, but it folds everything foldable — including
headings, which collapses the paper to an outline. That is a different feature
and deserves a different name if it is ever wanted.

`lib/foldCommands.ts` exports one pure `StateCommand`, in the same shape as
`lib/markdownCommands.ts`:

```ts
export const foldAllCodeBlocks: StateCommand
```

It walks the syntax tree for `FencedCode` nodes, asks `foldable()` for each
fence's range, and dispatches a single transaction of `foldEffect`s — one undo
step, and testable without a DOM.

**Unfold All reuses CodeMirror's built-in `unfoldAll` unchanged.** The
asymmetry is deliberate: folding is selective because the user is choosing what
to hide, while unfolding is total because "show me everything" has no edge
cases worth modelling.

### The dark-theme placeholder

`.cm-foldPlaceholder` — the pill shown where a folded block was — is hardcoded
in CodeMirror's base theme as `#eee` background, `#ddd` border, `#888` text.
`hermesTheme` does not override it, so a folded block in dark mode shows a
light-grey pill against `#1f1f1f`.

This is the same defect class the v0.5 final review found with the search
panel, and from the same cause: base-theme rules the theme does not override.
It is included here rather than deferred because **this change is what makes it
visible** — nobody sees a broken fold placeholder while nobody can find
folding.

Fixed with `var()` rules in `hermesTheme` for `.cm-foldPlaceholder` — its
background, border and text — using palette variables that already exist. The
fold gutter's arrows (`.cm-foldGutter span`) inherit the gutter colours
`hermesTheme` already sets, so they need nothing further; they are named here
only so an implementer does not go looking for a gap that is not there.

## The chord-ownership situation

This codebase has been bitten twice by CodeMirror claiming a chord before
AppKit's menu sees it: `⌘I` is `selectParentSyntax` and `⌘⇧K` is `deleteLine`
in `defaultKeymap`, and `Editor.svelte` re-binds both at `Prec.highest`.

`⌘⌥[` and `⌘⌥]` are the same situation via `foldKeymap`, but the consequence is
milder: the keystroke already performs exactly the action the menu item names,
so the menu item only has to work when **clicked**. No `Prec.highest` re-bind
is needed this time.

`CLAUDE.md` currently warns to check `defaultKeymap` before adding an
accelerator. That note should be widened to `foldKeymap` too, since the trap is
identical and the next person will hit it from a different direction.

## Components

| File | Change |
|---|---|
| `frontend/src/lib/foldCommands.ts` (new) | `foldAllCodeBlocks` |
| `frontend/src/lib/foldCommands.test.ts` (new) | Headless coverage |
| `frontend/src/Editor.svelte` | `.cm-foldPlaceholder` and fold-gutter rules in `hermesTheme` |
| `frontend/src/App.svelte` | `menu:fold` listener, `FOLD_COMMANDS` map, welcome-pane guard |
| `menu.go` | The four View-menu items |
| `CLAUDE.md` | Widen the keymap warning to `foldKeymap` |

Wiring follows the Format menu exactly, which is the established path: Go emits
`menu:fold` carrying a command name, `App.svelte` maps it through a record and
calls `editor.runCommand(...)`, guarded by `showWelcome` the way `applyFormat`
already is — without that guard, the menu accelerator would act on a hidden
document from the welcome screen.

The four command names carried by `menu:fold`, and what each maps to:

| Name | Command |
|---|---|
| `fold-block` | `foldCode` (CodeMirror) |
| `unfold-block` | `unfoldCode` (CodeMirror) |
| `fold-all-code` | `foldAllCodeBlocks` (ours) |
| `unfold-all` | `unfoldAll` (CodeMirror) |

Three of the four are CodeMirror's own `StateCommand`s used unchanged, so
`FOLD_COMMANDS` is mostly a lookup table; only `fold-all-code` is new code.

## Error handling

Nothing here can fail in a way worth surfacing. Folding an already-folded
block is a no-op; folding a document with no code blocks dispatches nothing;
an unknown command name from the event is ignored, as with `menu:format`.

## Testing

`foldCommands.test.ts`, headlessly, against a document containing two code
fences, a heading and a table:

- both fences end up folded;
- **neither the heading nor the table does** — the assertion that separates
  this command from the built-in `foldAll`, and the one that would catch a
  future refactor reaching for `foldAll` as a simplification;
- running it twice changes nothing the second time;
- it is a single undo step;
- an empty document is a no-op.

Editor component tests assert the generated stylesheet carries `var(…)` rules
for `.cm-foldPlaceholder`, matching how the other theme rules are already
pinned.

The menu items themselves are verified by the same manual pass the other menus
get — that they appear, and that clicking each does what its label says.
