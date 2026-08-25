# Hermes — Preview and PDF Styling: Design

**Date:** 2026-08-25
**Status:** Approved design, pending implementation plan
**Release:** v0.8.0 (third and last item)

## Overview

The roadmap item reads "settle the best styling and rendering approach for the
preview and the PDF", and names two open questions: whether print should keep
tracking the screen stylesheet or diverge deliberately, and whether the print
panel remains the export route.

Reading the code first turned up a third question that subsumes both. **The
preview has no document typography of its own.** It inherits `-apple-system`
sans from `body`, at the browser's default size, in a pane with no
`max-width` — so a paper renders full-bleed in the macOS UI font, at whatever
measure the window happens to be. The `@media print` block re-lights the
palette, hides the chrome, sets `11pt`/1.5 and `@page { margin: 2cm }`, but it
never changes the family. An exported PDF of an academic paper is San
Francisco, at full measure.

So the preview today is a *panel in an app*, and print is a set of patches
applied on top of it. The decision this design records is to make the preview
**a rendering of a document** instead, at which point the two named questions
answer themselves rather than needing separate rulings.

## The decisions

1. **The preview is a page, not a reading panel.** Serif body face, true paper
   geometry, a real type scale. The closer the preview is to the artefact, the
   less `@media print` has to be a pile of corrections.
2. **A sheet on a desk, not pagination.** The preview root becomes a white
   sheet with the print margins as real padding, floating on a darker desk,
   scrolling continuously. No page boxes and no page breaks.
3. **The sheet stays white in dark mode.**
4. **The palette splits into two namespaces**, chrome and document.
5. **The body face is `ui-serif`** — New York — fixed, behind one token.
6. **Export leaves the print panel.** File → Export PDF… renders at a known
   paper size with no panel; File → Print… keeps it.

Pagination (2) was considered and rejected. It means re-slicing content on
every keystroke, it fights the continuous line-to-offset mapping in
`scrollSync.ts`, and the honest page count still comes from the print panel
because the paper size is not known until something picks it. Showing
confident page breaks that the real export may not honour is worse than
showing none.

## Why the white sheet is the load-bearing decision

A white sheet in dark mode means **the document region is always light**. Three
things fall out of that, and together they are most of the work:

- The `@media print` palette override — fifty lines whose entire job was
  re-lighting a dark document — becomes dead. This is the roadmap's first
  question answered by construction: print stops *tracking* the screen palette
  because there is no longer anything to track.
- `--figure-bg`, `--figure-pad` and `--figure-radius` become dead. They exist
  solely to make figures read as cards *in dark mode*. On a permanently white
  sheet there is no dark mode to compensate for.
- One set of names can no longer serve both panes. `Editor.svelte`'s
  `HighlightStyle` reads `var(--syn-heading)` and friends from the ambient
  theme; `style.css` colours the preview's `.tok-*` classes from the *same*
  names. Today that is a feature — one table in `syntaxTags.ts`, two panes,
  guaranteed agreement. With a white sheet on a dark desk it is a
  contradiction: the editor wants those colours tuned for a dark ground, the
  preview wants them tuned for paper.

## Palette: two namespaces

`style.css`'s palette splits in two.

**Chrome tokens** keep varying by theme: `--bg`, `--border`, `--surface`,
`--divider`, `--overlay-bg`, `--toast-*`, the `--editor-*` set, the `--syn-*`
set, plus two new ones — `--desk` (the ground the sheet sits on) and
`--sheet-shadow`.

**Document tokens** are a new `--doc-*` set, declared **once**, light, in a
block no theme selector redefines: `--doc-bg`, `--doc-fg`, `--doc-link`,
`--doc-border`, `--doc-muted`, `--doc-surface-code-block`,
`--doc-surface-code-inline`, the `--doc-syn-*` roles, and the two faces
`--doc-font-body` and `--doc-font-mono`.

Every rule under the sheet is rewritten to name a `--doc-*` token.

The cheaper alternative was to keep every existing name and re-declare the
document-facing ones on the sheet root, letting custom properties cascade — a
few hours instead of a day, with no rule changes at all. It is rejected on the
project's own stated principle. The comment above `--accent` says that naming
it `--link` "would be a lie about intent every future reader has to see
through". Under the cascade approach `var(--fg)` in a sheet rule means
black-on-paper while the identical token twelve lines up means
theme-dependent chrome text — the same lie, at more sites. `--doc-*` makes the
sheet's invariance visible at every point of use.

`--sheet-shadow` must be a token rather than an inline `rgba(…)`:
`styleContract.test.ts` bans literal colours in a rule body, so a hardcoded
shadow colour fails the build.

**Deleted:** `--figure-bg`, `--figure-pad`, `--figure-radius`, the dark-mode
figure-card rules they feed, and the `@media print` palette block.

## The sheet

`Preview.svelte` gains one wrapper. `.preview-pane` remains the scroll
container, carries the `--desk` ground, and keeps the `ResizeObserver`; a new
`.sheet` inside it carries `--doc-bg` and becomes the `innerHTML` target and
the root the three hydrators walk.

**Two refs, not one.** `collectAnchors` measures with `getBoundingClientRect`
deltas against the container it is given *plus that container's `scrollTop`*,
so it must keep receiving `.preview-pane`. Only `innerHTML` and the hydrators
move to `.sheet`. Anchors are still found, because the sheet is a descendant.
Passing the sheet to `collectAnchors` instead would silently offset every
anchor by the sheet's top margin, and the sheet does not scroll so its
`scrollTop` would contribute nothing to correct it.

`data-figure-align` stays on `.preview-pane`; the existing descendant
selectors in `style.css` keep matching without change.

Geometry:

- **Width:** `min(<paper>, 100%)`, centred. `<paper>` is `210mm`/`297mm` (A4)
  or `216mm`/`279mm` (US Letter), selected by a new `PaperSize` setting
  crossed with the existing `PrintOrientation`.
- **Margins:** a percentage, not `25mm`. Percentage padding resolves against
  width, so the margin stays *proportionally* true at every sheet size,
  including when the sheet is shrunk below true size by a narrow pane.
  The percentage is `25mm / <paper width>`, so it is **set per paper size and
  orientation alongside the width, not once**: 11.90% (A4 portrait), 8.42% (A4
  landscape), 11.57% (Letter portrait), 8.96% (Letter landscape). A single
  fixed percentage would draw a 25mm margin on A4 portrait and a 35mm one on
  A4 landscape while `@page` printed 25mm for both — the sheet would lie for
  three of the four combinations.
- **Shadow and desk** are chrome, so both disappear in print.

### The narrow-window limitation, stated plainly

A4 is about 794px. In a split view on a 1440px window the preview pane is
around 720px, so the sheet **cannot** be true size. It shrinks rather than
clipping or scaling: text stays crisp and proportions stay right, but the
absolute measure is only true when the pane is wide enough.

Scaling with `transform: scale()` would preserve true size and was considered.
It is rejected twice over: it blurs text, and it breaks the
`getBoundingClientRect` arithmetic that scroll sync depends on.

## Typography

Body is `11pt`/`1.5` in `--doc-font-body` (`ui-serif`, resolving to New York),
matching print exactly — one value, no screen/print divergence to maintain.
Headings step `1.75 / 1.45 / 1.2 / 1.0em` at weight 600. Code keeps the
existing `ui-monospace, SFMono-Regular, Menlo` stack at `0.9em`, renamed to
`--doc-font-mono`.

New York is chosen because Apple ships it, it is designed as a text face for
screen *and* print, it costs nothing to bundle, and it pairs with the SF
chrome around it. Bundling an open academic serif (EB Garamond, Charter,
Libertinus, Source Serif) is the alternative, and becomes more attractive when
Windows and Linux come off the backlog. Defining the face as a single token
makes that a one-line change later rather than a refactor. A font *setting* is
YAGNI at this stage: a preference to maintain, a `normalise` clause, a menu
item and a migration, in service of a choice nobody has asked for.

**The margin default changes from 20mm to 25mm.** A4 at 20mm gives an
~88-character measure, which is poor. 25mm gives ~82 — still wide, because
that is what a one-column A4 paper genuinely is. The sheet shows the truth
rather than flattering it. Called out because it changes existing PDF output,
not just the screen.

Charts need no change. `CHART_WIDTH_PX.large` is 560px against a ~605px text
column at A4/25mm, so nothing overflows today. The sheet's contribution is
that the headroom becomes *visible* while editing, instead of a surprise at
export.

## Print and export

`@media print` keeps only what is genuinely print-specific: hiding the chrome,
`@page { margin: 25mm }`, the `break-inside`/`break-after` rules, and
`.sheet { width: auto; padding: 0; box-shadow: none }`.

**The padding must go to zero.** `@page` supplies the paper margin in print; a
sheet that kept its percentage padding would apply the margin twice.

Export splits from printing, which is the roadmap's second question:

- **File → Export PDF…** — a save dialog, then an `NSPrintOperation` built on
  a fixed `NSPrintInfo` with `NSPrintSaveJob`. No panel, so no paper
  substitution, so the ordering hazard documented at the top of
  `print_darwin.go` stops applying to this path at all, along with the class of
  truncation bug it guards against.
- **File → Print…** — keeps the panel, where picking a printer and a tray is a
  job the panel is actually good at.

The forcing argument is that the sheet has to know its paper size to be drawn,
so paper size becomes a setting. The moment it is, the print panel's own paper
picker is a *second source of truth for the same fact*: a user who picks US
Letter in the panel gets a PDF whose measure does not match the sheet they
wrote against. The preview would be lying, quietly, and only in the artefact.

## Verification

`styleContract.test.ts` needs a new contract, and the changes are not
cosmetic:

- Light and dark must still declare identical **chrome** names.
- `--doc-*` must be declared exactly once, and **never** inside a theme or
  print selector. This is the test that keeps the sheet invariant honest.
- The literal-colour ban extends over the new blocks.
- The print block no longer declares palette names at all, so the existing
  assertion that it declares the same names as light and dark is removed
  rather than adapted.

`contrast.test.ts` should cover the `--doc-*` roles against `--doc-bg`, which
is strictly more than it checks today: the print palette was never
contrast-checked, on the reasoning that a separate set would be five more
numbers nothing verifies. With one invariant document palette that reasoning
no longer applies.

One assumption is untested and gets an explicit step rather than a footnote:
**New York is a system font, and the PDF goes through WebKit's print path.**
It should subset and embed like any other face, but journal submission portals
reject PDFs with unembedded fonts, and that failure would surface at the worst
possible moment. Run `pdffonts` against a real exported file. If it does not
embed, that is the argument for bundling a serif sooner rather than later.

## Out of scope

- Pagination in the preview.
- A font-choice setting.
- Bundling a serif (revisit with Windows/Linux).
- Pandoc export (v0.9.0), which is a different output path entirely.
