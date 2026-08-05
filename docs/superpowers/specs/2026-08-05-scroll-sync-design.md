# Hermes v0.4 — Scroll Sync: Design

**Date:** 2026-08-05
**Status:** Approved design, pending implementation plan

## Overview

Optional scroll sync between the editor and preview panes: as the editor
scrolls, the preview follows. Off by default, toggled from a new View menu, and
persisted like the PDF orientation setting.

The roadmap left four questions open. All four are settled below, each with the
options considered.

## The four questions

### 1. Direction — one-way, editor drives preview

| Option | Verdict |
|---|---|
| **A — One-way: the editor drives the preview** | **Chosen** |
| B — Bidirectional | Rejected for now |

The editor is the pane holding authoritative source positions, so it is the
natural driver, and one-way is what the roadmap item actually describes.

The decisive argument is not simplicity for its own sake: bidirectional sync
needs a second (rendered → source) mapping *and* a last-scrolled-wins guard to
stop the two panes echoing each other into jitter. One-way needs neither —
because nothing listens to the preview's scroll, setting its `scrollTop`
cannot feed back. The echo class of bug does not exist rather than being
defended against.

Bidirectional remains additive later: the reverse mapping reuses the same
anchors.

### 2. Position mapping — source-line anchors with interpolation

| Option | Verdict |
|---|---|
| **A — `data-source-line` anchors, interpolated between** | **Chosen** |
| B — Proportional ratio of scroll positions | Rejected |
| C — Anchors, snapping to the nearest | Rejected |

This is the question the roadmap flagged as hardest: "how source position maps
to rendered position when the two heights diverge sharply — charts, math
blocks, and tables all render far taller or shorter than their markdown."

Anchors dissolve the problem instead of mitigating it. A markdown-it core rule
stamps `data-source-line` on every top-level block from `token.map`; the
mapping then interpolates *between* two known-correct anchors. A chart that
occupies three source lines and 400 rendered pixels is simply a long interval
between two exact points — no error term, and nothing to accumulate.

Verified against the project's own markdown-it before choosing: every level-0
block token carries a `map` (`heading_open [0,1]`, `fence [7,10]`,
`table_open [13,16]`), and the rule renders as
`<h1 data-source-line="1">`, `<p data-source-line="3">`,
`<table data-source-line="9">`.

B was rejected because it is wrong wherever the two heights diverge, which in
an academic paper is everywhere, and the error persists down the document
rather than self-correcting. C was rejected because it moves in discrete jumps
— worst precisely inside the long blocks anchors exist to handle.

### 3. Toggle location — a new View menu

| Option | Verdict |
|---|---|
| **A — View → Sync Scrolling, a checkbox item** | **Chosen** |
| B — A toolbar button | Rejected |
| C — Both | Rejected |

Matches the precedent already set by File → PDF Orientation: a persisted,
menu-driven setting. `menu.go` owns accelerators, so it fits the existing
structure. The toolbar holds four *action* buttons; this is a mode toggle and
would need a pressed state none of them have.

Wails' menu API supports this directly — `Menu.AddCheckbox` and
`MenuItem.SetChecked` both exist in v3.0.0-alpha2.118.

The View menu is placed after Format and before Window. No accelerator: the
obvious chords are taken, and this is not a frequent action. Blockquote in the
Format menu sets the same precedent.

### 4. Persistence — yes, in `Settings`

| Option | Verdict |
|---|---|
| **A — Persist, like PDF orientation** | **Chosen** |
| B — Session-only | Rejected |

Now that settings are generalised, the cost is a field and a default — a bool
needs no `normalise` clause, since every value it can hold is already valid
(see the Go section). Consistency with the app's only other preference wins.

## Architecture

```
CodeMirror scrollDOM ──scroll──▶ top visible line (posAtCoords)
                                        │
                                        ▼
                            lib/scrollSync.ts  (pure)
                     previewOffsetForLine(anchors, line, …) → y
                                        │
                                        ▼
                          .preview-pane scrollTop = y
```

Two facts about the panes that the implementation depends on, both verified:

- **The editor's scroller is CodeMirror's `view.scrollDOM`**, not
  `.editor-pane`. `.editor-pane` carries `overflow: auto`, but
  `.editor-host .cm-editor` is `height: 100%`, so CodeMirror's own
  `.cm-scroller` is what actually scrolls and `.editor-pane`'s overflow never
  engages.
- **The preview's scroller is `.preview-pane` itself** — the same element whose
  `innerHTML` is replaced on every render.

## The anchor rule

A `md.core.ruler.push` rule stamping `data-source-line` on every level-0 token
that has a `map`, using `map[0] + 1` for a 1-based line number.

Two gaps the rule does not cover on its own, both of which must be closed or
the feature is quietly wrong:

**Vega-lite charts would get no anchor at all.** `renderer.ts` overrides
`md.renderer.rules.fence` and builds its own HTML string for `vega-lite`
blocks, ignoring the token's attributes. Charts are the single largest source
of height divergence and the main reason anchors beat a ratio — so the override
must emit `data-source-line` itself.

**Cached chart nodes carry stale line numbers.** `charts.ts` caches a rendered
chart keyed by spec text and calls `el.replaceWith(cached)` on later passes.
The cached node keeps the `data-source-line` it was born with, so editing
*above* a chart silently desynchronises it while everything still looks
correct. The hydrator must copy the fresh placeholder's `data-source-line` onto
the cached node before reusing it.

That second point couples `charts.ts` to this feature slightly. Accepted
deliberately: the alternative is a desync bug that appears only after an edit
above a chart, which is exactly the kind of thing that goes unexplained for
months.

**Known minor offset:** for ordinary code fences, markdown-it places token
attributes on `<code>`, not the enclosing `<pre>`, so those anchors measure
~12px low (the `<pre>` padding). Not worth overriding the fence renderer to
correct.

## `lib/scrollSync.ts`

Pure and DOM-free, so it is testable headlessly — the same reasoning that put
the formatting commands in `lib/markdownCommands.ts`.

```ts
export interface Anchor {
  line: number  // 1-based source line
  top: number   // pixels from the top of the scroll content
}

export function previewOffsetForLine(
  anchors: Anchor[],   // ascending by line
  line: number,        // 1-based top visible editor line
  docLines: number,    // total lines in the document
  scrollHeight: number // preview scroll content height
): number
```

Boundary rules, stated explicitly because this is where such code usually goes
wrong:

- **Before the first anchor** — interpolate from a virtual anchor at
  `(line 1, y 0)`, so a document opening with frontmatter scrolls smoothly
  rather than pinning to the top until the first heading.
- **After the last anchor** — interpolate toward a virtual anchor at
  `(docLines, scrollHeight)`, so the end of the document stays reachable
  instead of clamping at the last block.
- **No anchors at all** (empty document) — return 0.
- **Exact hit on an anchor** — return its `top` with no interpolation.
- The result is clamped to `[0, scrollHeight]`; the browser clamps again
  against the viewport, which is harmless.

## Wiring

**`Editor.svelte`** exposes `topVisibleLine(): number`. It uses
`view.posAtCoords({ x, y })` at the scroller's top-left corner rather than
arithmetic on `scrollTop`, which keeps everything in one coordinate space
instead of reconciling `documentTop` and `documentPadding`. A null return (a
coordinate outside the content) falls back to line 1.

**`Preview.svelte`** owns anchor collection and the scroll application.
Anchors are measured as
`el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop`,
not `offsetTop`, so the measurement does not depend on any ancestor being
positioned.

Anchors are cached and invalidated on:
- the rendered html changing,
- chart hydration completing — charts change their own height *after* the
  render pass that created them,
- window resize.

Recomputation is lazy: the cache is rebuilt on the next sync that needs it, not
eagerly on invalidation. Scroll handling is coalesced into a
`requestAnimationFrame` so a burst of scroll events costs one measurement pass.

**`App.svelte`** becomes the first consumer of app settings — it currently
reads none. It reads `Settings()` at mount and re-reads on the existing
`settings:changed` event, and passes the flag down. When sync is off the scroll
handler returns early; the listener is not torn down.

## Go side

`Settings` gains:

```go
SyncScrolling bool `json:"syncScrolling"`
```

with `false` in `defaultSettings`. It needs **no clause in `normalise`** —
every bool is already a valid value. Worth an explicit comment, so the next
reader does not take its absence for an oversight.

`menu.go` gains a View submenu after Format:

```go
view := menu.AddSubmenu("View")
view.AddCheckbox("Sync Scrolling", current.SyncScrolling).OnClick(...)
```

The click handler read-modify-writes the whole `Settings` value, the way the
PDF orientation items already do, and logs a failed write.

## Error handling

Nothing here can fail in a way worth surfacing to the user. A missing anchor,
an unparseable `data-source-line`, or a null from `posAtCoords` all degrade to
"do not scroll" rather than throwing. A failed settings write is logged, as
with PDF orientation.

## Testing

**`scrollSync.test.ts`** — the pure mapper, headlessly:
- interpolation between two anchors,
- the virtual start anchor (a line before the first real anchor),
- the virtual end anchor (a line after the last),
- an exact anchor hit,
- an empty document,
- the motivating case: a block occupying few source lines and many rendered
  pixels maps proportionally *within* that block rather than jumping.

**Renderer tests** — `data-source-line` is emitted for headings, paragraphs,
tables, and fences, and for `vega-lite` chart placeholders specifically.

**Chart hydrator test** — a cached chart node reused on a later pass adopts the
new placeholder's `data-source-line` rather than keeping its original.

**Component tests** — following the per-file jsdom pattern now established in
`App.test.ts` and `Editor.test.ts`: scrolling the editor with sync on moves the
preview; with sync off it does not.

## Decisions worth revisiting

**Sync is driven by scroll position, not by the cursor.** Moving the cursor
with the keyboard scrolls the editor only when it leaves the viewport, so
cursor-driven navigation syncs coarsely. If that reads wrong in use, the fix is
additive: also sync on selection change.

**Anchor granularity is one line.** The top visible line is an integer, so the
preview advances in line-sized steps. Because anchors are typically many lines
apart, consecutive lines interpolate to visibly different offsets and the
motion reads as smooth. If it feels steppy in a document with many short
blocks, the refinement is to compute a fractional line from the scroll offset
within the top line.
