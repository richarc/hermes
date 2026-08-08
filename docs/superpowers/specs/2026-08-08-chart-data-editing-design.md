# Hermes — Editing a Chart's Data: Design

**Date:** 2026-08-08
**Status:** Approved design, pending implementation plan
**Release:** v0.6.0

## Overview

Reopening a chart in the builder prefills every control except the one that
matters most: the data box is empty. The table itself is seeded from the spec —
the dropdowns, types and live preview all work — but the text the table came
from is gone, so there is no way to edit a chart's data in the builder at all.
Fixing a typo or adding a row means re-pasting the whole table or hand-editing
JSON in the document, which is the work the builder exists to remove.

This fills the box.

## The bug underneath the omission

The empty box is not merely unhelpful. It is auto-focused on open, so the
cursor lands in it, and `oninput` runs `load()` on every keystroke:

- typing one character parses as a valid single-column header, replacing the
  seeded table with one column and no rows and clearing the axis selections;
- emptying the box sets `table = null`, unmounting the encode controls
  entirely.

Either way the chart's data is gone from the modal with no error, no warning
and no undo, because the box looked empty to begin with. Prefilling removes the
trap as a side effect: the box shows what it holds, so a destructive edit
becomes a visible act on visible text.

## Decisions

| Question | Decision |
|---|---|
| Where does the text come from? | Re-serialized from the seeded table |
| Is the original pasted text stored? | No |
| What about large tables? | Prefill regardless; the box scrolls |
| Delimiter on the way out | Always comma, whatever was pasted in |
| Guard against clearing the box? | No — Cancel already backs out |

**The original text is deliberately not stored.** Keeping it would mean putting
a Hermes-private field into a portable Vega-Lite spec, and it would go stale
the moment anyone hand-edited the block. `data.values` is already the truth;
the text is a view of it.

**No size threshold.** A collapsed-above-N-rows box would keep the dialog tidy
at the cost of a second state and a number nobody can justify. The box scrolls;
a large table is unwieldy to scroll through, which is the same as it was when
the table was pasted in.

## Components

| File | Change |
|---|---|
| `frontend/src/lib/dataTable.ts` | `toDelimited`, the inverse of `parseDelimited` |
| `frontend/src/lib/dataTable.test.ts` | Round-trip coverage |
| `frontend/src/ChartBuilder.svelte` | Seed `pasted`; relabel and enlarge the box |
| `frontend/src/ChartBuilder.test.ts` | Prefill and edit-on-reopen coverage |

### The serializer

```ts
export function toDelimited(table: DataTable): string
```

The header row, then one line per row, comma-delimited, `\n`-separated, no
trailing newline. A field is quoted only when it contains a comma or a double
quote; an inner quote is doubled. That is exactly the grammar `splitLine`
already parses, which is what makes the round trip exact rather than
approximate.

**A newline inside a value is replaced with a space, not quoted.**
`parseDelimited` splits the text into lines *before* `splitLine` ever sees a
quote, so an embedded newline is outside the grammar however it is written:
quoting it would produce a box whose contents fail to parse with a
row-length error the user did not cause. No table pasted into this box can
contain one — the only source is a hand-authored spec — so the box normalises
into the grammar it can read. The normalisation is lossy but visible, and it
reaches the document only if the user then edits and commits.

Numbers serialize with `String(n)`. Row values came from JSON, so this
round-trips them exactly; it is not a formatting decision so much as the
absence of one.

A table with no columns serializes to `''`, which is why the seeding below is
guarded rather than unconditional: `parseDelimited('')` is an error, not an
empty table.

**The round trip is exact for any chart the builder itself inserted, and only
for those.** That is not quite the same claim as "tables that came from
`parseDelimited`": a *reopened* chart's table always arrives through
`tableFromRows` (see the wiring below), so a boundary drawn at "which function
built this table" never actually applies to the case this whole feature is
about. The boundary that predicts behaviour is whether the *rows* originated
from the builder. `parseDelimited` never produces a numeric-looking string for
a column it infers `nominal`, so a builder-inserted chart's rows re-parse to
the same types and the same values.

A hand-authored spec can break that, and not only in the way a column's type
changes. Text is not the whole of a `DataTable`: a column carries a type, and
`toDelimited` writes only values. A table from `tableFromRows` can hold a type
inference would not produce — an integer ID column the author declared
`nominal` — and re-parsing re-infers it as `quantitative`. That part is correct
behaviour rather than a defect to design around, because the type the *chart*
uses is not read from the table. `xType`/`yType`/`colourType` are independent
state seeded from the spec, and `load()` never touches them — only picking a
column afresh from a dropdown does. So a user who reopens a chart with an
overridden type, edits the data text and commits still gets their override in
the spec. A test pins this, because it is exactly the kind of thing a later
refactor would break silently.

But the re-inferred type is not merely internal and unobserved — it can change
what a *different*, unrelated edit commits. `builderState.rows = table.rows`,
so a re-parsed value reaches `data.values` in the document. A hand-authored
`{ dose: '007' }` with `x.type: 'nominal'` prefills faithfully as `007`, but
editing any *other* cell reparses the whole table text and re-infers every
column fresh from its values: `007` looks numeric, so the column becomes
`quantitative` and the value becomes `7`. The axis keeps its declared `nominal`
type, but its labels change as a side effect of an edit the user made
somewhere else entirely. A sparse row hits a related trap: `tableFromRows` on
`[{a:1,b:2},{a:3}]` has no `b` key on the second row, but `toDelimited` writes
`''` for the missing cell, and re-parsing commits an explicit `b: ''` rather
than the absent key the original had. Vega-Lite filters a row with a missing
quantitative field out of the chart; it renders one whose field is `''` as a
real point at zero — so editing and committing can turn a gap in the data into
a point on the axis.

**Output is always CSV, even for a table pasted as TSV.** The original text is
not kept, so the delimiter cannot be. This is a real, if small, loss: a user
who pasted tab-separated data gets comma-separated data back. Comma is
`parseDelimited`'s own default for an unsniffable header, so a comma is never
the reason the output fails to re-parse — but it is not a guarantee that it
re-parses at all. `parseDelimited` rejects a single-column header containing
whitespace (`Sales Region`), and the check runs against the raw line, so
quoting does not rescue it. The seeding below guards against exactly that.

### The wiring

`pasted` stops being unconditionally `''` and seeds from the same `untrack`ed
block that seeds the table:

```ts
let pasted = $state(seedPasteText(seed.table))
```

`seedPasteText` serializes the table and then confirms the result re-parses,
falling back to `''` when it does not — the single-column-whitespace-header
case above. A box that breaks on the first keystroke would recreate the very
trap this feature exists to remove, so the guard is load-bearing rather than
defensive.

`load()`, `onPaste` and `chooseFile` are otherwise untouched: editing the
prefilled text goes through exactly the path a fresh paste goes through.

One rule does have to change. `load()` previously cleared an axis selection
whose column had vanished, which was safe when the only way to reach it was a
deliberate re-paste. Editing a prefilled header makes it fire on every
intermediate keystroke — retyping `dose` clears the selection at `d` and never
restores it, and re-picking the column from the dropdown resets its type,
silently discarding a declared `nominal` override. So the clearing goes, and
`ready` gains the requirement that every selected column still exists in the
table. That keeps the property the clearing rule protected — a spec can never
encode a column absent from the data — without destroying state to get it.
Mid-rename the preview blanks and Update disables, both visible, both restored
the moment the header is whole again.

Two presentation changes come with it. The textarea grows from `rows="6"` to
`rows="12"` when reopening a chart, because it then has something to show; a
fresh builder keeps six, rather than pushing its controls below the fold
behind twelve empty rows. And the label
"Paste a table" becomes "Data", which is true in both cases; the paste hint
moves to the textarea's placeholder, where it appears only when the box is
empty.

### What is deliberately not built

- No confirmation before clearing the box. The document is untouched until
  commit, so Cancel is already a complete undo.
- No "revert to the chart's data" button. Same reason.
- No change to charts the builder refuses to open at all — layers, transforms,
  a hand-set `title: null`. Those still refuse, with the same message.

## Testing

`dataTable.test.ts`, headless and pure:

- `parseDelimited(toDelimited(t))` returns `t`, where `t` itself came from
  `parseDelimited` — over text exercising commas, double quotes, newlines
  and a mix of quantitative and nominal columns;
- a value containing a newline comes back with a space in its place, and the
  result still parses;
- a header-only table (columns, no rows) round-trips;
- a table with no columns serializes to `''`;
- a `tableFromRows` table with an overridden type re-infers on the way back,
  documenting the asymmetry rather than pretending it does not exist.

`ChartBuilder.test.ts`, under jsdom:

- reopening with an `initial` prefills the box with the seeded rows;
- editing the prefilled text to add a row reaches the committed spec;
- a fresh builder — no `initial` — still opens with an empty box;
- reopening a chart whose x column was typed `nominal` over numeric-looking
  values, editing the data text, and committing still writes
  `"type": "nominal"` — the override survives the re-parse;
- that same override survives a character-by-character rename of the header
  column back to its own name, which is the case the old clearing rule broke;
- an axis naming a column absent from the data cannot be committed, pinning
  the property the clearing rule used to provide;
- a chart whose only column name contains a space opens with an empty box
  rather than text that fails to re-parse.

### What is not tested

Whether a 12,000-row table is pleasant to scroll. That is the judgement the
"no threshold" decision rests on, and it needs a human and a real table.

## Manual check

1. Insert a chart from a small pasted table. Reopen it: the box holds the same
   data, comma-separated, and the preview is unchanged.
2. Edit a value in the box; the preview updates and Update chart writes it.
3. Add a row; it appears in the chart.
4. Delete the header row's last column name so the header and rows disagree;
   the existing row-length error appears inline rather than silently.
5. Select all and delete; the encode controls disappear, and Cancel leaves the
   document's chart exactly as it was.
6. Reopen a chart built from a tab-separated paste; it comes back
   comma-separated and still renders.
