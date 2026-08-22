# Hermes — More Chart Types in the Builder: Design

**Date:** 2026-08-22
**Status:** Approved design, pending implementation plan
**Release:** v0.7.0

## Overview

The chart builder offers seven marks over one fixed encoding shape — an `x`, a
`y` and an optional `color`. That covers comparison and trend charts and
nothing else: a paper cannot draw a distribution, a matrix, or a mean with its
confidence interval. This adds four chart families that need shapes of their
own.

## Decisions

| Question | Decision |
|---|---|
| Which families | Histogram, heatmap, error bars, pie |
| How the author picks | One "Chart type" dropdown of eleven, with an adaptive form |
| Where the type is stored | Nowhere — derived from the spec on read |
| State shape | One flat `BuilderState`, not a discriminated union |
| Layered charts | Out of scope |

### Error bars are cheaper than the roadmap assumed

The v0.7 entry groups error bars with the work that "needs a transform or a
layer". That is true only of the *decorated* form — points drawn on top of the
bars. The bare form is a single mark:

```json
{
  "mark": {"type": "errorbar", "extent": "ci"},
  "encoding": {
    "x": {"field": "variety", "type": "nominal"},
    "y": {"field": "yield", "type": "quantitative"}
  }
}
```

`mark` widens from a string to a string-or-object and nothing else changes.
This matters out of proportion to its cost: of the four families here, error
bars are the one a scientific paper actually needs.

## The chart type is derived, never stored

The document keeps a plain Vega-Lite spec with no Hermes marker in it, which is
what keeps a chart portable — the same reasoning that put captions in each
format's native home. `readSpec` infers the type from the mark and the
encoding shape.

| Chart type | Spec |
|---|---|
| line, bar, point, area, boxplot, tick, rule | `mark: "<name>"`, `x` + `y` (+ `color`) — unchanged |
| Histogram | `mark: "bar"`, `x: {bin: true, type: "quantitative"}`, `y: {aggregate: "count"}` |
| Heatmap | `mark: "rect"`, ordinal `x`/`y`, `color: {type: "quantitative", aggregate?}` |
| Error bars | `mark: {type: "errorbar", extent}`, ordinary `x` + `y` |
| Pie | `mark: "arc"`, `theta` + `color`, **no `x` or `y`** |

**Inference runs most-specific first**, and the order is load-bearing:

1. `mark` is an object whose `type` is `errorbar` → Error bars
2. `mark` is `arc` and `theta` is present → Pie
3. `mark` is `rect` and `color.type` is quantitative → Heatmap
4. `mark` is `bar` and `x.bin` is set → Histogram
5. `mark` is a plain name in the existing list → that type
6. otherwise refuse, as now

A bar chart carrying a `count` aggregate but no `bin` therefore still reads
back as **Bar**. Every chart in every existing document must reopen exactly as
it does today; that is the first thing to test, not the last.

## State

`BuilderState` stays one flat shape:

```ts
chartType: ChartType          // replaces `mark`
rows:      Record<string, string | number>[]
x:         Encoding                                    // unused by pie
y:         ValueEncoding                               // pie: the slice size (theta)
colour:    { field, type, aggregate? } | null          // heatmap: the value; pie: the category
extent:    Extent                                      // error bars only
extras:    Record<string, unknown>
```

`colour` gains a type and an aggregate because a heatmap's colour carries a
*quantity* rather than a grouping. `buildSpec` branches on `chartType` to
decide which channels to emit.

**A discriminated union was considered and rejected.** It is the purer model —
pie genuinely is not an x/y chart, and a union would make an invalid
combination unrepresentable. It was rejected because it would rewrite
`ChartBuilder.svelte`, `App.svelte` and every existing test for one family's
benefit, while the guarantee that actually matters — the rebuild-and-compare
round trip — is unaffected either way. The cost is that `y` means "theta" for
a pie, which needs a comment to be legible. Revisit if a fifth family arrives
that also abandons `x`/`y`.

## The round trip is the contract

`readSpec` decides editability by construction: derive a candidate, rebuild it
with `buildSpec`, compare. Every new family must round-trip byte-exactly or
reopening a chart of that family refuses. This is not a nicety — it is the
mechanism that stops a hand-edit being silently discarded, so each new type
needs its own round-trip case before anything else.

## Components

| File | Change |
|---|---|
| `frontend/src/lib/chartSpec.ts` | `ChartType`, `Extent`, the state changes, `buildSpec` branching, the inference ladder |
| `frontend/src/lib/chartSpec.test.ts` | Round trips, inference precedence, backward compatibility |
| `frontend/src/ChartBuilder.svelte` | The Chart type dropdown, the adaptive form, per-type readiness and labels |
| `frontend/src/ChartBuilder.test.ts` | Form adaptation, readiness, selection survival |
| `docs/test-document.md` | One fixture per new type |

### The builder's form adapts

| Type | Insert enabled when |
|---|---|
| line, bar, point, area, tick, rule | `x`, and (`y` or a count aggregate) |
| boxplot | `x` and `y` — aggregate ignored, as now |
| Histogram | `x` only; `y` *is* the count |
| Error bars | `x` and `y` |
| Heatmap | `x`, `y` **and** colour — the value is not optional |
| Pie | slice size and category; `x` irrelevant |

Labels follow the type: for a pie the `y` control reads **Slice size** and
colour reads **Category**; for a heatmap colour reads **Value** and gains an
aggregate. The author never sees `bin`, `theta` or `extent` — the builder
derives them from the chart they chose.

## Testing

Three things carry the risk.

**Round trips.** A case per new type, added to the existing table in
`chartSpec.test.ts`.

**Inference precedence**, which is where silent wrongness would live:

- `bar` + `count` with no `bin` reads back as Bar, not Histogram
- `rect` with a *nominal* colour refuses rather than posing as a heatmap
- `arc` without `theta` refuses

**Backward compatibility.** A spec written by today's builder must still read
identically — asserted against a literal spec string, not a rebuilt one, so a
future change to `buildSpec` cannot quietly make the test agree with itself.

In the builder: choosing Histogram hides the Y control; choosing Pie relabels;
readiness matches the table above; and **switching type keeps column
selections that still apply**, which is the annoyance a naive implementation
ships.

## Out of scope

Layered charts — points over error bars, a regression line over a scatter.
Those need `layer` and `transform` inside the round trip, which
`PASSTHROUGH_KEYS` excludes deliberately, because carrying them alongside the
`mark`/`encoding` pair `buildSpec` emits would produce a spec that is not valid
Vega-Lite. That is its own piece of work.

Also out of scope: `circle`, `square` and `trail`, which fit the existing shape
and are free to add but are cosmetic variants of `point` and `line` — skipped
on 2026-08-09 for that reason, and the reasoning has not changed.
