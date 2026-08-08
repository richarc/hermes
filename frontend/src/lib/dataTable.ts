/** How Vega-Lite should treat a column. */
export type FieldType = 'quantitative' | 'temporal' | 'nominal'

export interface Column {
  name: string
  type: FieldType
}

export interface DataTable {
  columns: Column[]
  rows: Record<string, string | number>[]
}

export type ParseResult =
  | { ok: true; table: DataTable }
  | { ok: false; message: string }

// Deliberately strict rather than Date.parse, which accepts bare integers in
// some engines and would type a year column as temporal.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/

/** Splits one line on `delim`, honouring double-quoted fields. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delim) {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out
}

function isNumeric(v: string): boolean {
  if (v === '') return false
  const n = Number(v)
  return Number.isFinite(n)
}

export function inferType(values: string[]): FieldType {
  const present = values.filter((v) => v !== '')
  if (present.length === 0) return 'nominal'
  if (present.every(isNumeric)) return 'quantitative'
  if (present.every((v) => ISO_DATE.test(v))) return 'temporal'
  return 'nominal'
}

/**
 * Parses pasted or imported delimited text into typed columns and rows.
 *
 * Quoted fields may contain the delimiter but not a line break: splitting
 * happens per line, which keeps this simple and covers the clipboard cases
 * that matter. A field with an embedded newline reports a row-length error
 * rather than being silently mangled.
 */
export function parseDelimited(text: string): ParseResult {
  const normalised = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (normalised.trim() === '') {
    return { ok: false, message: 'Paste or import a table with a header row.' }
  }

  const lines = normalised.split('\n')
  const tabs = (lines[0].match(/\t/g) ?? []).length
  const commas = (lines[0].match(/,/g) ?? []).length
  // A single-column table's header has neither: nothing to sniff from, and
  // nothing that needs splitting, so comma is a harmless default. But a
  // header with neither delimiter AND whitespace is not a header at all —
  // it's the first line of a paragraph someone pasted by accident. A real
  // column name is a token ("year", "group"); prose is not. Reject that
  // case rather than silently reporting a bogus one-column, one-row table.
  if (tabs === 0 && commas === 0 && /\s/.test(lines[0])) {
    return {
      ok: false,
      message: 'Expected a comma- or tab-separated table with a header row.',
    }
  }
  const delim = tabs > commas ? '\t' : ','

  const header = splitLine(lines[0], delim).map((h) => h.trim())
  if (header.some((h) => h === '')) {
    return { ok: false, message: 'Every column in the header row needs a name.' }
  }
  if (new Set(header).size !== header.length) {
    return { ok: false, message: 'Two columns share a name; each needs its own.' }
  }

  const raw: string[][] = []
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') continue
    const cells = splitLine(lines[i], delim)
    if (cells.length !== header.length) {
      return {
        ok: false,
        message: `Row ${i + 1} has ${cells.length} values but the header has ${header.length}.`,
      }
    }
    raw.push(cells.map((c) => c.trim()))
  }

  const columns: Column[] = header.map((name, col) => ({
    name,
    type: inferType(raw.map((r) => r[col])),
  }))

  const rows = raw.map((cells) => {
    const row: Record<string, string | number> = {}
    columns.forEach((c, i) => {
      row[c.name] = c.type === 'quantitative' && cells[i] !== '' ? Number(cells[i]) : cells[i]
    })
    return row
  })

  return { ok: true, table: { columns, rows } }
}

/**
 * Rebuilds a DataTable from rows that were already parsed elsewhere — e.g.
 * reopening a previously inserted chart, where the spec's rows are available
 * but the column types are not carried alongside them.
 *
 * `knownTypes` supplies the authoritative type for any column already mapped
 * to an encoding (read out of the spec itself, not re-derived); every other
 * column is inferred from its full run of values, the same way
 * `parseDelimited` types a freshly pasted column — not from a single row,
 * which cannot distinguish "this row happens to be a number" from "this
 * column is quantitative."
 */
export function tableFromRows(
  rows: Record<string, string | number>[],
  knownTypes: Record<string, FieldType> = {},
): DataTable {
  const names = Object.keys(rows[0] ?? {})
  return {
    columns: names.map((name) => ({
      name,
      type: knownTypes[name] ?? inferType(rows.map((r) => String(r[name] ?? ''))),
    })),
    rows,
  }
}

/**
 * Renders a table as delimited text — the inverse of `parseDelimited`, for
 * putting an already-parsed table back in front of the user to edit.
 *
 * Always comma-separated, whatever the original paste used: the source text is
 * not stored anywhere, so its delimiter cannot be. Comma is `parseDelimited`'s
 * own default for a header it cannot sniff, so most output re-parses this way
 * — but not all of it. A column name `parseDelimited` itself would never
 * write into a header (one containing whitespace with no comma or tab to
 * sniff a delimiter from, or an empty name — both reachable only from a
 * hand-authored spec via `tableFromRows`, never from a paste) serializes into
 * text that fails to re-parse. A caller that hands this text back to the user
 * for editing must check first; see `ChartBuilder.svelte`'s `seedPasteText`.
 *
 * The round trip is exact for any chart the builder itself inserted, and only
 * for those — not, as the shape of this function might suggest, for tables
 * that came from `parseDelimited` specifically. A *reopened* chart's table
 * always arrives through `tableFromRows` (see `ChartBuilder.svelte`'s
 * `seed`), so that boundary would never apply to the case it exists to
 * describe. The boundary that predicts behaviour is whether the *rows*
 * originated from the builder. `parseDelimited` never produces a
 * numeric-looking string for a column it infers `nominal`, so a
 * builder-inserted chart's rows re-parse to the same types and the same
 * values. A hand-authored spec can break both: `{ dose: '007' }` declared
 * `nominal` prefills faithfully as `007`, but editing any other cell reparses
 * the *whole* table text and re-infers every column fresh from its values —
 * `007` looks numeric, so it reparses `quantitative` and the value becomes
 * `7`. The chart's declared axis type survives that (it is builder state
 * `load()` never reads back off the table), but the value reaching
 * `data.values` does not — the axis's own labels change as a side effect of
 * an unrelated edit. A sparse row hits a related trap: `tableFromRows` on
 * `[{a:1,b:2},{a:3}]` has no `b` key on the second row, but this function
 * writes `''` for the missing cell, and re-parsing commits an explicit
 * `b: ''` rather than the absent key the original had. Vega-Lite filters a
 * row with a missing quantitative field out of the chart; it does not filter
 * one whose field is `''` — that renders as a real point at zero. So editing
 * and committing can turn a gap in the data into a point on the axis.
 */
export function toDelimited(table: DataTable): string {
  if (table.columns.length === 0) return ''
  const names = table.columns.map((c) => c.name)
  const lines = [names.map(quoteField).join(',')]
  for (const row of table.rows) {
    lines.push(names.map((name) => quoteField(String(row[name] ?? ''))).join(','))
  }
  return lines.join('\n')
}

/**
 * One field, quoted only if it would otherwise be misread.
 *
 * `splitLine` treats a comma as a separator and a double quote as opening a
 * quoted run wherever it appears, so those two are the whole list; an inner
 * quote is doubled, which is what `splitLine` unescapes.
 *
 * A newline is different in kind. `parseDelimited` splits the text into lines
 * before `splitLine` ever runs, so an embedded newline is outside the grammar
 * however it is written — quoting it would produce a box that fails to parse
 * with a row-length error the user did not cause. No table pasted into the box
 * can contain one; the only source is a hand-authored spec. So it is
 * normalised into the grammar instead, losing the line break and keeping the
 * table readable.
 */
function quoteField(value: string): string {
  const flat = value.replace(/\r\n?|\n/g, ' ')
  if (!/[",]/.test(flat)) return flat
  return `"${flat.replace(/"/g, '""')}"`
}
