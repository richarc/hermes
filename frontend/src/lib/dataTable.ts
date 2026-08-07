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

function inferType(values: string[]): FieldType {
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
  // nothing that needs splitting, so comma is a harmless default.
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
