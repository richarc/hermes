/**
 * GFM pipe tables as the table builder reads and writes them.
 *
 * Deliberately separate from dataTable.ts: that module infers a *type* per
 * column for chart encoding, and a markdown table has none — what it has
 * instead is an alignment per column, which has nowhere to live in
 * DataTable. Cells are raw markdown source; nothing here interprets them.
 */

export type Alignment = 'left' | 'center' | 'right' | null

export interface PipeTable {
  header: string[]
  /** One entry per column; null means no marker in the delimiter row. */
  align: Alignment[]
  rows: string[][]
}

export type ParsePipeResult =
  | { ok: true; table: PipeTable }
  | { ok: false; reason: 'no-delimiter' | 'empty' }

// A delimiter cell: optional colon, at least one dash, optional colon.
const DELIM_CELL = /^:?-+:?$/

/**
 * Splits one table row into cells. An escaped pipe (`\|`) is a literal pipe
 * inside a cell, not a boundary; one optional leading and trailing pipe are
 * dropped, as GFM does.
 */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let i = 0
  const s = line.trim()
  const start = s.startsWith('|') ? 1 : 0
  const end = s.endsWith('|') && !s.endsWith('\\|') ? s.length - 1 : s.length
  for (i = start; i < end; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cell += '|'
      i++
    } else if (ch === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell.trim())
  return cells
}

function alignmentOf(cell: string): Alignment {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return null
}

export function parsePipeTable(text: string): ParsePipeResult {
  const lines = text
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return { ok: false, reason: 'empty' }
  if (lines.length < 2) return { ok: false, reason: 'no-delimiter' }

  const header = splitRow(lines[0])
  const delim = splitRow(lines[1])
  if (delim.length !== header.length || !delim.every((c) => DELIM_CELL.test(c))) {
    return { ok: false, reason: 'no-delimiter' }
  }
  const align = delim.map(alignmentOf)
  const width = header.length
  const rows = lines.slice(2).map((line) => {
    const cells = splitRow(line).slice(0, width)
    while (cells.length < width) cells.push('')
    return cells
  })
  return { ok: true, table: { header, align, rows } }
}
