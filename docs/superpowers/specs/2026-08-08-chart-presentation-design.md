# Hermes — Figure Presentation: Design

**Date:** 2026-08-08
**Status:** Approved design, pending implementation plan
**Release:** v0.6.0

## Overview

Charts and images currently render flush left at Vega-Lite's intrinsic width,
with no caption and no number. A paper needs figures that are captioned,
numbered, and consistently placed. This adds all three.

The governing rule is **a caption is what makes a figure**. Without one, a block
renders exactly as it does today — so existing documents are untouched until
their author adds a caption.

## Decisions

| Question | Decision |
|---|---|
| What counts as a figure? | Charts and images, sharing one number sequence |
| Where is a caption written? | Each format's native home — image alt text, chart spec `title` |
| How much numbering? | Automatic, in document order. No cross-references. |
| Chart width | A document-wide default the spec can override |
| Alignment | A document-wide setting: left, centre, right |

**Captions use each format's native home** rather than an invented syntax.
`![Caption](img.png)` is exactly Pandoc's figure convention, and a Vega-Lite
`title` is where a chart's own title belongs. Nothing new is invented, both
files stay portable, and a paper converted through Pandoc keeps its captions.

**Cross-references are out of scope.** Pointing at a figure by name needs a
label scheme, two-pass resolution (a reference can precede its figure), an
unresolved-reference error path, and a decision about whether labels share a
namespace with citekeys. That belongs beside the citation machinery, not bolted
onto rendering.

## What becomes a figure

| Source | Becomes a figure when | Caption from |
|---|---|---|
| ` ```vega-lite ` block | its spec has a usable `title` | that `title` |
| `![alt](src)` alone in a paragraph | its alt text is non-empty | that alt text |

Empty alt stays decorative and unnumbered — the accessibility convention, and
it stops a spacer image consuming a figure number.

Vega-Lite allows three shapes for `title`; all are accepted:

| `title` value | Caption |
|---|---|
| `"Recovered sources"` | used directly |
| `{"text": "Recovered sources"}` | the `text` |
| `{"text": ["line one", "line two"]}` | joined with a space |
| anything else, or absent | no caption → not a figure |

## Components

| File | Change |
|---|---|
| `frontend/src/lib/figures.ts` *(new)* | markdown-it plugin: numbering pass and figure construction. Pure. |
| `frontend/src/lib/figures.test.ts` *(new)* | Headless coverage. |
| `frontend/src/lib/renderer.ts` | Uses the plugin; the fence renderer lifts `title` and injects `width`. |
| `frontend/src/ChartBuilder.svelte` | A Caption field; preview mirrors the document. |
| `frontend/public/style.css` | Figure alignment, width guard, print break rule. |
| `settings.go` | `figureAlignment` and `chartWidth`. |
| `menu.go` | Two View submenus. |
| `frontend/src/App.svelte` | Passes the two settings into `render()`. |

### The rendering pass

One core rule walks top-level tokens, counts captioned figures in document
order, and stamps each with its number. Charts then emit through the existing
fence renderer, which already hand-builds HTML. Images need token surgery: a
`<figure>` cannot live inside the `<p>` markdown-it wraps them in, so the
paragraph tokens become figure tokens with a figcaption appended.

```html
<figure data-source-line="12">
  <div class="vega-lite-chart" data-spec="…"></div>
  <figcaption>Figure 2 — Recovered sources by condition</figcaption>
</figure>
```

Numbering needs no persistent state: `render()` re-runs on every debounced
change, so the count is recomputed each pass and inserting a figure renumbers
everything below it on the next keystroke.

**The caption label is `Figure N — `**: the word "Figure" in full, the number,
then a spaced em dash, then the author's text. It is written into the HTML
rather than produced by a CSS counter, so it survives copy-paste and PDF text
extraction as real text.

An image that becomes a figure **keeps its `alt` attribute** as well as gaining
the caption. The two serve different readers: the caption is visible to
everyone, the alt describes the image when it fails to load or is read aloud.

### Two render-time spec rewrites

The fence renderer parses the spec and rewrites it before emitting `data-spec`:

1. **`title` is lifted out and removed.** Otherwise Vega-Lite draws the caption
   inside the SVG as well and it appears twice.
2. **`width` is injected when absent**, from the `chartWidth` setting. An author
   who wrote `"width": 300` keeps it.

Both are render-time only. The builder reads a block's raw text from the editor,
so `readSpec` still sees `title` and passes it through untouched — `title` and
`width` are both already in the passthrough allowlist, which is what makes the
override reliable.

`charts.ts` caches by spec text, so a settings change alters the key and charts
re-embed. That is the correct behaviour.

## Settings

Two fields, following the established pattern — a field, a default, a clamp;
persistence, the `settings:changed` event, the menu rebuild and the TS model all
follow with no extra wiring.

| Field | Values | Default |
|---|---|---|
| `figureAlignment` | `left` / `centre` / `right` | `centre` |
| `chartWidth` | `small` / `medium` / `large` → 240 / 400 / 560 | `medium` |

Those pixel values are Vega-Lite's `width`, which sizes the **plotting area**
and excludes axes, tick labels and the legend. A chart rendered at `width: 400`
therefore occupies noticeably more than 400px in total — worth knowing before
tuning the numbers against a page.

Both get a View submenu of radio items, matching PDF Orientation and Appearance.
Alignment applies to charts and images whether or not they are captioned —
alignment is about the figure, not the caption.

It is applied as `text-align` on `.preview-pane figure`, `.preview-pane
.vega-lite-chart` and `.preview-pane img`, driven by a `data-figure-align`
attribute on the preview root rather than by injecting a class per element. A
figure's `<img>` matches twice, which is harmless: `text-align` inherits and the
inner value equals the outer. Charts and images that are not figures are covered
by the same rule, which is why alignment does not depend on captioning.

Hermes spells its own identifiers `centre`; CSS spells it `center`. The mapping
happens at the boundary, as it already does for `colour` / `color`.

**`width: "container"` is deliberately avoided.** It adapts perfectly to the pane
but needs `autosize` handling and a container of definite width — more machinery
than this warrants. Fixed pixel widths are used instead, with the overflow guard
below.

## Interactions

**Scroll sync.** `collectAnchors` does `querySelectorAll('[data-source-line]')`,
so any element carrying the attribute becomes an anchor. Wrapping a chart
naively would put it on both the `<figure>` and the inner div, giving two
anchors for one source line at different offsets — and since
`previewOffsetForLine` interpolates between anchors, a duplicated line is a
degenerate segment. **The attribute moves to the `<figure>` and must not remain
on the child.** This gets its own test.

**Print.** `break-inside: avoid` extends from `.vega-lite-chart` to `figure`, or
a caption orphans onto the next page — a failure the in-SVG title did not have.

**Overflow.** A fixed-width chart can exceed a narrowed preview pane, and
`.preview-pane` scrolls, so the whole pane would scroll sideways. Instead
`.vega-lite-chart svg { max-width: 100%; height: auto }` scales an oversized
chart down. Label text shrinks slightly at extreme pane widths; that is the
better failure.

**The builder.** A Caption text input writes `extras.title` as a plain string.
Its preview must mirror the document — strip the title from the embedded spec
and render the caption as text beneath — or the builder shows the caption inside
the chart while the document shows it below.

## Error handling

Everything falls back to today's rendering.

| Situation | Result |
|---|---|
| Chart JSON unparseable | No caption, not a figure; the existing error card still handles the chart |
| `title` present but not a usable shape | Not a figure |
| Empty alt | Not a figure — decorative, unnumbered |
| Linked image `[![alt](img)](url)` | Not a figure; only a bare image qualifies |
| Two images in one paragraph | Not a figure — ambiguous which is captioned |

## Testing

`figures.ts` is pure and tested headlessly by rendering markdown and asserting
HTML:

- numbering runs in document order across a mix of charts and images;
- each non-qualifying case in the table above is left unchanged;
- all three `title` shapes produce a caption;
- inserting a figure renumbers those below it.

The one that protects an existing feature:

> `data-source-line` appears **exactly once** per figure.

Go tests clamp the two new settings, as the existing settings tests do.

### What is not tested

Whether centring and the widths actually *look* right. jsdom has no layout
engine and every rect is 0, so this stays a manual check — the same honest limit
the project already accepts for theme appearance and menu rendering.

## Manual check

1. A document with a captioned chart, a captioned image, and an uncaptioned
   chart: the first two are numbered 1 and 2, the third is untouched.
2. Insert a captioned figure above them; everything renumbers.
3. Switch View → Figure Alignment through left, centre and right.
4. Switch View → Chart Width through small, medium and large; a chart with an
   explicit `"width"` does not move.
5. Narrow the preview pane until a large chart would overflow; confirm it scales
   rather than scrolling the pane sideways.
6. Export a PDF with a figure near a page boundary; the caption stays with it.
7. Create a chart in the builder with a caption; confirm the preview shows it
   below the chart, not inside it.
