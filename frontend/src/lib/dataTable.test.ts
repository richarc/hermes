import { describe, it, expect } from 'vitest'
import { parseDelimited, tableFromRows, toDelimited } from './dataTable'

function ok(text: string) {
  const r = parseDelimited(text)
  if (!r.ok) throw new Error(`expected success, got: ${r.message}`)
  return r.table
}

describe('parseDelimited', () => {
  it('reads a comma-separated table with a header', () => {
    const t = ok('dose,response\n0,1.5\n5,3.25\n')
    expect(t.columns).toEqual([
      { name: 'dose', type: 'quantitative' },
      { name: 'response', type: 'quantitative' },
    ])
    expect(t.rows).toEqual([
      { dose: 0, response: 1.5 },
      { dose: 5, response: 3.25 },
    ])
  })

  it('reads tab-separated text, which is what Excel puts on the clipboard', () => {
    const t = ok('group\tscore\na\t1\nb\t2\n')
    expect(t.columns.map((c) => c.name)).toEqual(['group', 'score'])
    expect(t.rows).toEqual([
      { group: 'a', score: 1 },
      { group: 'b', score: 2 },
    ])
  })

  it('types a column as nominal when any value is not numeric', () => {
    const t = ok('id,label\n1,alpha\n2,beta\n')
    expect(t.columns).toEqual([
      { name: 'id', type: 'quantitative' },
      { name: 'label', type: 'nominal' },
    ])
    expect(t.rows[0]).toEqual({ id: 1, label: 'alpha' })
  })

  it('types ISO dates as temporal and keeps them as strings', () => {
    const t = ok('when,n\n2026-01-05,3\n2026-02-06,4\n')
    expect(t.columns[0]).toEqual({ name: 'when', type: 'temporal' })
    expect(t.rows[0]).toEqual({ when: '2026-01-05', n: 3 })
  })

  it('does not mistake a plain number for a date', () => {
    // Date.parse('1') succeeds in some engines; the parser must not rely on it.
    const t = ok('year\n1\n2\n')
    expect(t.columns[0].type).toBe('quantitative')
  })

  it('honours double quotes around a field containing the delimiter', () => {
    const t = ok('name,note\n"Smith, J",ok\n')
    expect(t.rows[0]).toEqual({ name: 'Smith, J', note: 'ok' })
  })

  it('unescapes a doubled quote inside a quoted field', () => {
    const t = ok('q\n"she said ""hi"""\n')
    expect(t.rows[0]).toEqual({ q: 'she said "hi"' })
  })

  it('tolerates CRLF line endings', () => {
    const t = ok('a,b\r\n1,2\r\n')
    expect(t.rows).toEqual([{ a: 1, b: 2 }])
  })

  it('names the offending line when a row has the wrong number of values', () => {
    const r = parseDelimited('a,b,c\n1,2,3\n4,5\n')
    expect(r.ok).toBe(false)
    if (r.ok) return
    // Line 3 of the pasted text: the header is line 1.
    expect(r.message).toContain('3')
    expect(r.message).toContain('2')
  })

  it('rejects empty input', () => {
    expect(parseDelimited('   ').ok).toBe(false)
  })

  it('rejects a header with a blank column name', () => {
    const r = parseDelimited('a,,c\n1,2,3\n')
    expect(r.ok).toBe(false)
  })

  it('rejects a header with duplicate column names', () => {
    const r = parseDelimited('a,a\n1,2\n')
    expect(r.ok).toBe(false)
  })

  it('accepts a header with no data rows and reports no rows', () => {
    const t = ok('a,b\n')
    expect(t.columns.map((c) => c.name)).toEqual(['a', 'b'])
    expect(t.rows).toEqual([])
  })

  it('rejects a pasted paragraph that is not a table', () => {
    // No comma, no tab, and a header line with whitespace: the shape of
    // prose, not a column name. Must not silently become a bogus
    // one-column table named after the first line.
    const r = parseDelimited('This is a paragraph.\nIt has several lines.\nEach line is here.\n')
    expect(r.ok).toBe(false)
  })

  it('parses a single-column table whose header is a single token', () => {
    const t = ok('id\n1\n2\n')
    expect(t.columns).toEqual([{ name: 'id', type: 'quantitative' }])
  })

  it('parses a single-column table for the count-aggregation case', () => {
    const t = ok('group\na\nb\na\n')
    expect(t.columns).toEqual([{ name: 'group', type: 'nominal' }])
    expect(t.rows).toEqual([{ group: 'a' }, { group: 'b' }, { group: 'a' }])
  })

  it('does not type free-form date strings as temporal', () => {
    // Date.parse accepts both of these; the ISO regex does not. This test
    // fails if ISO_DATE is ever swapped for a Date.parse-based check —
    // unlike the bare-integer test, whose protection comes from checking
    // isNumeric before dates and would not catch that swap.
    const t = ok('when,n\nJan 5 2026,1\nMar 6 2026,2\n')
    expect(t.columns[0].type).toBe('nominal')
  })

  it('reports a row-length mismatch rather than hanging on an unterminated quote in the header', () => {
    const r = parseDelimited('"a,b\n1,2\n')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toMatch(/values/)
  })

  it('reports a row-length mismatch rather than hanging on an unterminated quote in a data row', () => {
    const r = parseDelimited('a,b\n"1,2\n3,4\n')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toMatch(/values/)
  })
})

describe('tableFromRows', () => {
  it('keeps a mapped column typed temporal even when its values would not infer that way', () => {
    // "Jan 2026" is not ISO, so inferType alone would call this nominal —
    // this is the regression: the encoding's authoritative type must win.
    const rows = [{ when: 'Jan 2026', n: 1 }, { when: 'Feb 2026', n: 2 }]
    const t = tableFromRows(rows, { when: 'temporal' })
    expect(t.columns).toContainEqual({ name: 'when', type: 'temporal' })
  })

  it('infers an unmapped column of ISO dates as temporal, not nominal', () => {
    const rows = [{ when: '2026-01-05', n: 1 }, { when: '2026-02-06', n: 2 }]
    const t = tableFromRows(rows, { n: 'quantitative' })
    expect(t.columns).toContainEqual({ name: 'when', type: 'temporal' })
  })

  it('infers an unmapped column as nominal when only its first row looks numeric', () => {
    const rows = [{ code: 5 }, { code: 'n/a' }]
    const t = tableFromRows(rows)
    expect(t.columns).toContainEqual({ name: 'code', type: 'nominal' })
  })
})

describe('toDelimited', () => {
  it('writes a header row and one line per row, comma-separated', () => {
    const t = ok('dose,response\n0,1.5\n5,3.25\n')
    expect(toDelimited(t)).toBe('dose,response\n0,1.5\n5,3.25')
  })

  it('emits no trailing newline', () => {
    expect(toDelimited(ok('a\n1\n'))).toBe('a\n1')
  })

  it('quotes a field containing a comma or a quote, and doubles inner quotes', () => {
    const t = ok('label,n\n"Smith, J.",1\n"He said ""hi""",2\n')
    expect(toDelimited(t)).toBe('label,n\n"Smith, J.",1\n"He said ""hi""",2')
  })

  it('leaves ordinary fields unquoted', () => {
    // Quoting everything would also re-parse correctly, so this pins the
    // choice: the box is something a human reads and edits.
    expect(toDelimited(ok('a,b\nx,y\n'))).toBe('a,b\nx,y')
  })

  it('round-trips a table that came from parseDelimited', () => {
    // Exact only for parse-derived tables — see the nominal-override test
    // below for the asymmetry.
    const text = 'label,n,when\n"Smith, J.",1,2024-01-01\n"a ""quoted"" one",2,2024-02-01'
    const t = ok(text)
    expect(ok(toDelimited(t))).toEqual(t)
  })

  it('round-trips a header-only table', () => {
    const t = ok('a,b')
    expect(t.rows).toHaveLength(0)
    expect(ok(toDelimited(t))).toEqual(t)
  })

  it('serializes a table with no columns as the empty string', () => {
    expect(toDelimited({ columns: [], rows: [] })).toBe('')
  })

  it('replaces a newline inside a value with a space, keeping the text parseable', () => {
    // parseDelimited splits on newlines before splitLine sees a quote, so an
    // embedded newline is outside the grammar however it is written. Quoting
    // it would hand the user a box that fails to parse.
    const t = tableFromRows([{ label: 'two\nlines', n: 1 }], {})
    const text = toDelimited(t)
    expect(text).toBe('label,n\ntwo lines,1')
    expect(ok(text).rows).toEqual([{ label: 'two lines', n: 1 }])
  })

  it('re-infers a declared type on the way back, which is why types are not read from the table', () => {
    // tableFromRows can hold a type inference would never reach. The chart's
    // own type lives in the builder's xType/yType state, not here.
    const t = tableFromRows([{ id: 1 }, { id: 2 }], { id: 'nominal' })
    expect(t.columns[0].type).toBe('nominal')
    expect(ok(toDelimited(t)).columns[0].type).toBe('quantitative')
  })
})
