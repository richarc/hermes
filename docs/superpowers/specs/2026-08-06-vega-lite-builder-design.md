# Hermes — Vega-Lite Chart Builder: Design

**Date:** 2026-08-06
**Status:** Approved design, pending implementation plan
**Release:** v0.6.0

## Overview

Charts are the last part of Hermes that still requires hand-writing JSON. The
builder lets you import a table, choose a mark and some encodings, watch the
chart update live, and drop the result into the document — then reopen it later
to change your mind.

The model is Livebook's `kino_vega_lite` Chart smart cell, with one structural
difference that drives most of this design. A smart cell binds to a variable
already in scope in the notebook runtime. Hermes has no runtime and no variable
scope: a markdown file is all there is, so the data has to physically live
somewhere in the document.

## Decisions

| Question | Decision |
|---|---|
| Where does chart data live? | Inline, in the spec's `data.values` |
| Can an existing chart be reopened? | Yes, when the spec is one the UI can express |
| How does data get in? | Paste **and** file import |
| Where does the UI appear? | Full-window modal overlay |
| What does the UI model? | Five marks, x/y/colour, axis titles, aggregation |
| How is it invoked? | New Insert menu, plus a toolbar button |

**Inline data** keeps the document self-contained — a paper can be emailed to a
co-author and its charts still render. It also needs no Go file-watching at all.
The cost is long blocks, which is tolerable because v0.5's collapsible blocks
hide exactly this.

This deliberately does not use `data.url`. Beyond breaking self-containment, a
remote URL is the network-fetch vector recorded in the backlog's security item:
`vega-loader` fetches it on render, with no click and no prompt.

## Scope

The UI models a single-view spec with:

- **Marks:** line, bar, point, area, boxplot
- **Encodings:** x, y, and an optional colour — which is also how multi-series
  works, since a colour field splits one line into one per group
- **Field types** are inferred by `dataTable.ts` but shown in a dropdown beside
  each encoding, so the user can override a wrong guess — a numeric-looking ID
  column that is really nominal is the common case
- **Aggregation** on the `y` encoding: mean, median, sum, count. Not offered for
  boxplot, which computes its own summary and would conflict
- **Axis titles**, editable

Aggregation earns its place despite being the only item here beyond a minimal
core: scientific data usually arrives as one row per observation rather than
pre-summarised, and in Vega-Lite it is a single extra property the library does
all the work for. Without it, the user detours through Excel — the exact detour
the builder exists to remove.

Error bars and confidence intervals are **out of scope**. Vega-Lite builds those
as layered specs, and layering breaks the single-view assumption that keeps the
round-trip rule below simple. They are the natural v0.7.

## Components

| File | Responsibility |
|---|---|
| `frontend/src/lib/dataTable.ts` *(new)* | `parseDelimited(text)` → columns, rows, inferred types. Pure. |
| `frontend/src/lib/chartSpec.ts` *(new)* | `buildSpec(state)` → spec JSON; `readSpec(json)` → a `ReadResult`. Pure. |
| `frontend/src/ChartBuilder.svelte` *(new)* | The modal. Owns UI state; renders the live preview. |
| `frontend/src/Editor.svelte` | Gains `enclosingChartBlock()` and `replaceRange()`. |
| `frontend/src/App.svelte` | Modal state, `menu:insert-chart` listener, create-vs-edit dispatch. |
| `documentservice.go` | `ImportData()` — filtered dialog, read, return text. |
| `menu.go` | Insert submenu; move Insert Citation…; add Insert Chart…. |

Logic lives in `lib/` as pure functions with headless tests and the components
stay thin, following `markdownCommands.ts`, `foldCommands.ts` and
`scrollSync.ts`.

Keeping `buildSpec` and `readSpec` as an inverse pair in one module is the point
of that file: it makes "does the round-trip actually round-trip?" a property to
test rather than a claim to make.

### The live preview costs nothing new

`charts.ts` already lazy-loads vega-embed on first use, and `embedChart` already
takes spec text and an element. The modal reuses it. A document with no charts
still never loads Vega.

### Finding the block under the cursor

`enclosingChartBlock()` walks the syntax tree for the `FencedCode` node
containing the cursor and returns `{ from, to, spec }` when its info string is
`vega-lite`, or `null`.

`foldCommands.ts` already walks `FencedCode` nodes, so the technique is proven
here — **including the lesson that cost a fix round in v0.5**: CodeMirror's
syntax tree is incomplete past roughly 3000 characters unless forced with
`ensureSyntaxTree`, and reading it requires `state.update({}).state` because
`Language.state`'s cached tree only refreshes through a transaction. A chart
block late in a long paper would otherwise be silently invisible, exactly as a
late fence silently failed to fold.

## Data flow

Invoking the builder asks one question first — is the cursor inside a
`vega-lite` block?

```
Insert > Chart... (or toolbar)
        |
   enclosingChartBlock()
        |
   +----+----------------+
   |                     |
  null              {from,to,spec}
   |                     |
 CREATE              readSpec(spec)
   |                  /        \
 empty modal      state         null
   |                |             |
 paste/import    prefilled     toast; block untouched,
   |             modal          modal never opens
 configure         |
   |             configure
 [Insert chart]    |
   |             [Update chart]
 insertAtCursor    |
                 replaceRange(from, to, ...)
```

After a create, the cursor lands after the new block and the block is **folded
on insert** — it is typically fifty lines of data, and v0.5 built the machinery
to hide exactly that.

## The round-trip rule

`readSpec` decides whether a spec is editable **by construction**, not by
checking a list of disqualifying features:

> Parse the spec, derive a candidate state, rebuild from that state, and compare
> against the original. If they do not match semantically, refuse.

A checklist of exclusions — layers, facets, transforms, unknown marks — would
drift out of step with `buildSpec` every time the UI gained a control. Deriving
the answer keeps the boundary self-maintaining: anything `buildSpec` can express
is accepted automatically, and anything it cannot is refused.

It also makes silent data loss structurally impossible. A discarded hand-edit is
precisely what makes the rebuild differ, so the check cannot pass while losing
one. And it yields a behaviour that would otherwise need arguing for: a chart
whose axis title was tweaked by hand still reopens, because that tweak is inside
the model. Only edits outside it refuse.

Comparison is on parsed JSON, so key order and whitespace are irrelevant.

### What `readSpec` returns

The two refusals need different messages, so a bare `null` is not enough to tell
them apart:

```ts
type ReadResult =
  | { ok: true; state: BuilderState }
  | { ok: false; reason: 'invalid-json' }
  | { ok: false; reason: 'unsupported'; unconsumed: string[] }
```

`unconsumed` is what makes the refusal specific rather than a shrug. Comparing
rebuilt against original already identifies where they diverge, so the property
paths the derived state failed to account for — `transform`, `layer`, `facet`,
`selection` — fall out of the same comparison. The message names the first one
or two: *"This chart uses transform, which the builder can't edit."*

Without that, the honest message would be "this chart is too complex", which
tells the user nothing about what to remove.

## Error handling

Problems inside the modal report inline — a toast behind an open dialog is the
wrong place to put a message about the dialog's own contents.

| Situation | Response |
|---|---|
| Paste is not tabular | Inline: expected comma- or tab-separated with a header row |
| Ragged rows | Inline, naming the row: "row 12 has 4 values, header has 3" |
| Mark, x, or y not chosen | Insert disabled; the disabled state is the message |
| More than 5,000 rows | Warn with the count, but allow — aggregation makes large raw inputs legitimate, so this is verbosity, not error |
| File read fails | Toast, via the existing Go error path |
| Existing block is not valid JSON | Toast: the block is not valid JSON |
| Existing block is too complex | Toast naming what was found; block untouched |

The last two are deliberately different messages because the fixes differ: one
is a typo to repair, the other is a capability limit to work around.

## Testing

The two pure modules carry the weight, headlessly.

**`dataTable.ts`:** delimiter sniffing (comma vs tab), quoted fields containing
delimiters, ragged rows, type inference across numbers/dates/strings, CRLF line
endings, empty input, header-only input.

**`chartSpec.ts`:** `buildSpec` output per mark; refusal by `readSpec` for a
layered spec, a spec with transforms, an unknown mark, `data.url`, and invalid
JSON — asserting the `reason` distinguishes bad JSON from an unsupported spec,
and that `unconsumed` names the offending property rather than being empty.
Plus the test that matters most:

> For a set of builder states, `readSpec(buildSpec(s))` deep-equals `s`.

That property is what catches the two functions drifting apart, which is this
design's most exposed failure mode.

**`ChartBuilder.svelte`** under jsdom: paste populates the column dropdowns;
Insert stays disabled until x and y are set.

**`App.svelte`:** both modes end to end — create inserts a fenced block at the
cursor, edit replaces the enclosing block, and after a refusal **the document is
byte-identical**.

**Go:** `ImportData` opens a dialog and so is not unit-testable. Split the
readable part — resolve, read, size-check — into a function that is, mirroring
how `ReadBibliography` is testable while `Open` is not.

### What is not tested

Whether the live chart *looks* right. vega-embed needs real layout and
measurement; jsdom has neither, and every rect is 0. This stays a manual check,
the same honest limit the project already accepts for theme appearance and menu
rendering.

## Manual check

1. Insert → Chart… with the cursor in open prose. Paste a table, pick line, x
   and y. The preview draws. Insert — the block lands folded, and the preview
   pane shows the chart.
2. Put the cursor inside that block and reopen. The controls are prefilled.
   Change the mark to bar and update; the block is replaced in place.
3. Hand-edit the block to add a `transform` array, then reopen. It refuses by
   name and leaves the block alone.
4. Import a CSV through Choose file… rather than pasting.
5. Confirm the modal is legible in both light and dark appearance.
