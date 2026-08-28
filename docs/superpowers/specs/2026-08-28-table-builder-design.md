# Hermes — Table Builder: Design

**Date:** 2026-08-28
**Status:** Approved design, pending implementation plan
**Release:** v0.10.0

## Overview

Markdown tables are the worst hand-editing experience left in Hermes: pipes,
a delimiter row that has to be got exactly right, and columns that drift out
of line the moment a cell changes width. The roadmap frames this as the same
shape of problem the chart builder solved — a modal that owns a block of the
document and writes it back — with most of the parts already built.

The design here is that modal: **Insert → Table…** opens a spreadsheet-like
grid, and committing writes a padded GFM pipe table into the document, either
inserted at the cursor or replacing the table the cursor is in. Cells hold raw
markdown source, so an unedited table round-trips exactly and inline markup —
`**bold**`, `[@key]`, links — passes through untouched.

Two things distinguish it from the chart builder, both named by the roadmap
item. A markdown table is *editable as text*, so reopening one means parsing
pipe-table syntax rather than JSON. And column alignment (`:---`, `---:`)
has no home in `lib/dataTable.ts`, whose columns carry a *type* for chart
encoding rather than an alignment. So the builder gets its own small
pipe-table module rather than stretching `DataTable` to fit.

## Decisions

- **Editing UX: an editable grid**, not a paste box with a preview. Cells are
  typed into directly; delimited text can still be brought in through an
  Import section that reuses `parseDelimited`.
- **Cells are markdown source.** The grid shows and edits the raw text of each
  cell. No rendering inside the grid, no type inference, no escaping beyond
  what a pipe inside a cell needs.
- **Output is padded.** Columns line up in the source, with the delimiter row
  widened to match. Readable source is the point of a builder; the cost is a
  larger diff when one cell grows, which is accepted.
- **A header row is mandatory** — GFM has no headerless table — so the grid
  always has one, and a column can never be removed when it is the last.
- **Insert or replace**, decided by whether the cursor is inside a table when
  the builder opens, exactly as the chart builder decides from
  `enclosingChartBlock`.

Not in scope: rendering markdown inside cells, sorting, drag-reordering rows
or columns, column types, opening the builder from the preview, and a
keyboard accelerator (Chart… has none either).

## Components

### `lib/pipeTable.ts` (new, pure)

```ts
export type Alignment = 'left' | 'center' | 'right' | null

export interface PipeTable {
  header: string[]
  /** One entry per column; null means no marker. */
  align: Alignment[]
  rows: string[][]
}

export type ParsePipeResult =
  | { ok: true; table: PipeTable }
  | { ok: false; reason: 'no-delimiter' | 'empty' }

export function parsePipeTable(text: string): ParsePipeResult
export function serializePipeTable(table: PipeTable): string
```

`parsePipeTable` accepts what markdown-it and GFM accept: an optional leading
and trailing pipe on each row, `\|` as an escaped pipe inside a cell, a
delimiter row of `-`s with optional `:` at either end, and ragged body rows,
which are padded with empty cells or truncated to the header's width as GFM
does. Cell text is trimmed. Blank lines before or after the table are
ignored; anything that is not a table (no delimiter row on line 2, or nothing
at all) is refused with a reason rather than guessed at.

`serializePipeTable` writes `| a | b |` rows with each column padded to its
widest cell (minimum 3, so the delimiter is always `---`), the delimiter row
carrying `:---`, `:---:` or `---:` for an aligned column, and `|` inside a
cell escaped as `\|`. It appends no trailing newline; the caller decides how
the block is placed. The pair round-trips: `serialize(parse(t))` for any
table `t` this module wrote is `t` again, and `parse(serialize(p))` is `p`.

Column width is measured in code points, not UTF-16 units, so a cell with an
accented character still lines up.

### `Editor.svelte`: `enclosingTable()`

The same shape as `enclosingChartBlock`, and for the same reasons:
`forceParsing` first, because a table late in a long paper is not in the tree
until parsing is forced, then `resolveInner` on both sides of the cursor,
walking up to a `Table` node. Returns `{ from, to, text }` or `null`.
`markdown()` defaults to plain CommonMark, which has no table syntax at all,
so `Editor.svelte` passes `extensions: [Table]` to `markdown()` to get
`Table`, `TableRow`, `TableCell` and `TableDelimiter` into the tree.
`@lezer/markdown`, which exports that `Table` extension, became an explicit
dependency for this.

### `TableBuilder.svelte` (new)

A modal in the `ChartBuilder` mould: same overlay and panel styling, the same
`initial` / `oncommit` / `oncancel` props, `initial` read once at mount.

```ts
interface Props {
  /** The table under the cursor, or null for a new one. */
  initial: PipeTable | null
  oncommit: (table: PipeTable) => void
  oncancel: () => void
}
```

A new table starts as three columns (`Column 1`, `Column 2`, `Column 3`) and
two empty body rows, no alignment.

Layout, top to bottom:

- **Alignment strip** — one control per column with four states (none, left,
  centre, right), shown as a segmented toggle above each header cell.
- **Grid** — the header row as `<input>`s styled as headers, body rows as
  `<input>`s, an **✕** at the end of each row and at the foot of each column.
  The last column's ✕ is disabled; the last body row's ✕ is enabled, since a
  header-only table is valid GFM.
- **+ Row** and **+ Column** buttons beneath the grid. A new column is named
  `Column N` and appended; a new row is empty.
- **Import** — a disclosure containing a textarea. Text pasted or typed there
  is parsed with `parseDelimited`; on success the whole grid is replaced
  (header from the columns, rows as strings, alignment reset to none); on
  failure the textarea shows the parser's reason inline and the grid is left
  alone. Import is a one-way replace: the grid never writes back into it.
- **Footer** — Cancel, and Insert or Update according to whether `initial`
  was null. Commit is disabled while every cell in the table is empty.

Keyboard: Tab and Shift-Tab move through cells in reading order; Enter in a
body cell moves down one row, and on the last row adds a row and moves into
it; Escape cancels. The first header cell takes focus on open, as the chart
builder's paste box does, because the modal does not block keystrokes from
reaching the editor beneath it.

`oncommit` receives the `PipeTable`, not text: serialising is App's job, so
the component has no opinion about how the block is placed and the test for
padding lives with the serialiser.

### `App.svelte` wiring

Mirrors the chart path. State `tableOpen`, `tableInitial: PipeTable | null`,
`tableTarget: { from, to } | null`.

`openTableBuilder` refuses when the builder is already open (so a second
trigger cannot silently retarget a pending insert), when the welcome pane is
showing, when a confirm dialog is pending, or when the chart builder or the
New Document dialog is open. It then asks `editor.enclosingTable()`: nothing
means a fresh builder with no target; a table is parsed with `parsePipeTable`,
and a refusal — which should be rare, since Lezer only produces a `Table` for
text that is one — toasts *"That table couldn't be read, so it can't be
opened here."* and leaves the document alone.

`commitTable(table)` serialises, then:

- with a target, re-reads `editor.textInRange(from, to)` and requires
  `parsePipeTable` to accept it before `replaceRange` — the chart path's
  safety net against a range captured before the document changed;
  otherwise toasts *"That table moved while the builder was open, so it
  wasn't changed."*
- with no target, `insertBlockAtCursor(text + '\n')`.

Every existing guard of the form `if (chartOpen) return` that protects the
document from menu-driven edits gains `|| tableOpen`, and `openChartBuilder`
gains `if (tableOpen) return` so the two builders are mutually exclusive.

### `menu.go`

`Insert → Table…` after Chart…, emitting `menu:insert-table` with no payload.
No accelerator. The toolbar in `App.svelte` gets a **Table** button beside
**Chart**.

### Documentation

`CLAUDE.md`'s events list gains `menu:insert-table`; the `ChartBuilder`
architecture note gains a sentence pointing at `TableBuilder` and
`lib/pipeTable.ts`. `README.md`'s feature list and `docs/hermes-authoring.md`
mention the builder; `CHANGELOG.md` gets an Unreleased entry; the roadmap
item is ticked with the usual dated note.

## Error handling

- A table the grammar recognises but the parser refuses: toast, no change.
- Import text that does not parse: inline message in the Import section, grid
  untouched.
- A target range that no longer holds a table at commit: toast, no change,
  builder closes.
- A cell containing `|`: escaped on serialise, unescaped on parse — never a
  broken table in the document.

## Testing

- `lib/pipeTable.test.ts` — parse: leading/trailing pipes present and absent,
  escaped pipes, each alignment form, ragged rows both ways, surrounding
  blank lines, refusals. Serialise: padding, code-point widths, alignment
  markers, minimum delimiter width, pipe escaping. Round trips in both
  directions.
- `TableBuilder.test.ts` — under the jsdom setup `ChartBuilder.test.ts` uses:
  the default new table; editing cells; add and remove row and column, with
  the last-column guard; alignment toggles; Enter on the last row; import
  success and failure; commit payload; commit disabled when empty; focus on
  open; Escape cancels.
- `App.test.ts` — insert when no table is under the cursor; replace when one
  is; the moved-target refusal; chart and table builders refusing to open over
  each other; the menu event opening the builder.
- Real-app check: `wails3 task build && wails3 task run`, confirming the
  binary carries the new symbol before reporting, per `CLAUDE.md`.
