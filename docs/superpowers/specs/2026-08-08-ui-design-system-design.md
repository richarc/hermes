# Hermes — Consistent UI Elements: Design

**Date:** 2026-08-08
**Status:** Approved design, pending implementation plan
**Release:** v0.8.0 (first of three items)

## Overview

Hermes' chrome grew one feature at a time, and it shows. There are fourteen
`<button>` elements in the source and exactly one of them is styled. The
stylesheet opens with `* { margin: 0; padding: 0 }`, so the other thirteen are
native controls with no padding at all. There is no `:hover`, `:active`,
`:disabled` or `:focus-visible` rule anywhere in the application.

This is the release that gives the chrome a vocabulary, taken now rather than
later because the next three features — a table builder, an outline panel and
a code-block picker — all add UI, and should inherit a vocabulary instead of
adding to the pile.

Scope is the first of v0.8's three bullets. The document-source colour scheme
and the preview/PDF styling question are separate.

## What is actually there today

| Element | Styling today |
|---|---|
| 5 toolbar buttons | `-webkit-app-region: no-drag` only — no visual rule |
| 3 chart-builder buttons | none |
| 3 unsaved-changes buttons | none |
| Recents list buttons | `display: block; padding: 6px 0` — links, not boxes |
| 2 welcome actions | `.welcome-action`: the one real button style |
| Inputs and selects | styled only under `.encode-step` |
| Textarea | one `.chart-builder textarea` rule |
| Dialogs | `.modal-backdrop` + `.modal` + `.modal-buttons`, duplicated across two components |

Two defects fall out of that table rather than being separate bugs.
`.chart-builder` sets `max-height: 90vh; overflow-y: auto` on the whole
dialog, so a large pasted table scrolls Cancel and Insert chart out of sight.
And neither dialog traps focus, so Tab walks out of the modal into the
document behind it.

## Decisions

| Question | Decision |
|---|---|
| Button style | Quiet bordered default, one filled primary |
| Where primary applies | Dialog confirm actions only |
| Accent colour | New `--accent`, valued as the existing link colour |
| Dialog anatomy | Shared shell; each dialog keeps its internals |
| Dialog element | Native `<dialog>` with `showModal()` |
| Component extraction | `Dialog.svelte` only — no Button or Field components |

**No Button component.** Fourteen call sites styled by an element selector is
less machinery than fourteen call sites importing a component, and Svelte
gives no encapsulation benefit here that a selector does not. A dialog is
different: it carries behaviour, not just appearance.

**Primary is for dialogs, not the toolbar.** Open, Save, Cite, Chart and
Export PDF are peers; promoting one would be a claim about what the user is
about to do that Hermes cannot support. In a dialog the claim is true — there
is a default action, and it is what Return does.

## Tokens

Two new names, in all three palette blocks:

| Name | Light | Dark | Print |
|---|---|---|---|
| `--accent` | `#0b57c2` | `#7cb0ff` | `#0b62d6` |
| `--on-accent` | `#ffffff` | `#12233d` | `#ffffff` |

The values match the existing link colours. A separate name is still right:
the palette's discipline is that a name states a role, and `background:
var(--link)` on a button would be a lie about intent that survives into every
future reading of the rule.

`contrast.test.ts` gains one pair — `['primary button', '--on-accent',
'--accent', 4.5]` — which passes at 6.65:1 light and 7.13:1 dark. It checks
`:root` and the dark block only; `styleContract.test.ts` separately requires
both names in the print block too.

## Buttons

Three kinds, because the recents list needs one the mock-ups did not show.

- **Default** — the element selector `button`. A `--surface` fill, a
  `--border-strong` border, 6px radius, real padding. This is
  `.welcome-action` promoted, so that rule is deleted rather than kept.
- **`.primary`** — `--accent` fill, `--on-accent` text. Dialog confirm
  actions only.
- **`.link-button`** — no border, no fill, inherits colour. The welcome
  pane's recents are `<button>`s acting as links, and turning a column of
  file paths into a column of bordered boxes would be worse than today. The
  existing `.welcome button` rule becomes this class.

### States

None of these exist today.

- `:hover` — the default's border darkens to `--fg`. The primary uses
  `filter: brightness(0.92)` rather than a second token, which is the one
  formulation that works in both themes: it reads as a darker blue in light
  and a dimmer blue in dark, and it keeps `--on-accent` above 4.5:1 either
  way (dark falls from 7.13:1 to roughly 6.3:1). A `--accent-hover` token
  would need its own contrast pair and its own value in three blocks to say
  the same thing.
- `:active` — no transform, no shadow; this is a document editor.
- `:disabled` — `opacity: .45; cursor: default`. This drops the filled button
  below 4.5:1, which is permitted: WCAG 1.4.3 exempts inactive controls. The
  rule carries a comment saying so, or a reviewer will read it as a bug.
- `:focus-visible` — `outline: 2px solid var(--accent); outline-offset: 2px`.

**The focus ring is the one that must not be forgotten.** Styling a control
removes the browser's default ring, and Hermes has a focusable element that
is not a control at all: `.divider` carries `tabindex="0"` for the WAI-ARIA
window-splitter pattern and currently relies entirely on the UA ring. It gets
the same treatment explicitly.

## Form controls

`.encode-step select, .encode-step input` and `.chart-builder textarea` are
promoted to element-level selectors so a control looks the same wherever it
appears. `.chart-builder textarea`'s full-width rule stays, being layout
rather than appearance.

**This reaches less far than it looks.** CodeMirror's find/replace panel —
`basicSetup`'s `searchKeymap`, opened with ⌘F — renders real `<input>` and
`<button>` elements inside the editor, but it was already themed from the
palette before this branch (`Editor.svelte`'s `hermesTheme`). CodeMirror
compiles its own theme rules as `.ͼN .cm-textfield` / `.ͼN .cm-button`, at
(0,2,0), which beats the bare element selectors here at (0,0,1); the app-wide
rules do not restyle the panel's text field or buttons. The one exception is
`button:not(:disabled):hover` at (0,2,1), which does beat `.ͼN .cm-button`
and gives the panel's buttons a `--fg` hover border they did not have before —
cosmetically fine, and a place to look during the manual check rather than a
surprise afterwards. What the element selectors on `input` do reach are the
panel's three unclassed `input[type=checkbox]` boxes (Match case / By word /
regexp), which is why that selector excludes checkboxes and radios via
`:not(:where(...))` rather than staying a bare `input`.

Controls inside `.preview-pane` are not a concern: markdown-it runs with
`html: false` and no plugin here emits a form control.

## Dialogs

One `Dialog.svelte` wrapping a native `<dialog>`, used by both call sites. It
owns the shell — `::backdrop`, radius, padding, the footer row — plus
`showModal()`/`close()` and Esc. Each dialog keeps its own internals, so the
chart builder's grid and the confirm dialog's sentence are unchanged.
`.modal-backdrop`, `.modal` and `.chart-builder`'s sizing collapse into it.

What the native element buys: focus containment for Tab, Esc-to-close,
inertness of the rest of the page, and top-layer rendering that cannot be
defeated by a stacking context.

**The footer becomes sticky.** `position: sticky; bottom: 0` with the
dialog's own background behind it, which fixes the scrolled-away Insert
button without adopting a header/body/footer skeleton.

### What this does *not* fix

`App.svelte`'s `if (chartOpen) return` guards all stay. They exist because
`menu:format`, `menu:new`, `menu:open` and `close:confirm` arrive from AppKit
through Go's event bus, not through the DOM — a focus trap cannot intercept
an event that never touches the webview. Anyone reading the new dialog and
concluding the guards are now redundant would reintroduce every bug they were
written for.

### jsdom does not implement `showModal`

Verified against the installed jsdom 30.0.0: the `<dialog>` element exists,
but `showModal` and `close` are `undefined`. Calling one throws, so an
unguarded component would break every test that mounts a dialog — which is
most of `ChartBuilder.test.ts` and several in `App.test.ts`.

The component feature-detects and falls back to setting the `open` attribute,
which jsdom does reflect. This is the same shape as `Preview.svelte`'s
`typeof ResizeObserver === 'undefined'` guard, whose comment already records
that it is load-bearing for tests rather than defensive.

The consequence is honest and worth stating: the focus trap, Esc handling and
inertness are real browser behaviours that jsdom cannot exercise, so they are
manual checks, not assertions.

## Testing

Existing guards cover more of this than usual, because the palette already
has contracts:

- `styleContract.test.ts` fails on a literal colour in any rule, and requires
  `--accent` and `--on-accent` in all three palette blocks the moment they
  are added.
- `contrast.test.ts` gains the primary-button pair.

New:

- `Dialog.svelte`: renders its content when open and not when closed; falls
  back to the `open` attribute where `showModal` is absent, so mounting under
  jsdom does not throw; calls its `onclose` on Esc.
- The existing `ChartBuilder.test.ts` and `App.test.ts` suites are the real
  regression net here — both mount dialogs, and both must pass unchanged.

### What is not tested

Whether any of it looks right, and whether focus is genuinely trapped. jsdom
has no layout engine and no top layer. Same honest limit the theme and
figures work already accepts.

## Manual check

1. Every button in the toolbar, both dialogs and the welcome pane has
   padding, a border and a hover state, in light and dark.
2. Tab through the toolbar and the pane divider: every stop shows a focus
   ring, including the divider.
3. Open the chart builder with a large pasted table: Insert chart stays
   visible while the body scrolls.
4. With the builder open, press Tab repeatedly — focus stays inside it — and
   press Esc — it closes without committing.
5. With the builder open, use a menu accelerator (⌘B, ⌘N): still refused, as
   before. The guards are unchanged and must remain effective.
6. ⌘F in the editor: the find panel's input and buttons still look like
   CodeMirror's own theme, not the app's — only the buttons' hover border
   picks up `--fg` (see Form controls, above).
7. Export a PDF: chrome is hidden as before, and no accent colour appears.
