import { describe, it, expect } from 'vitest'
import { parseDelimited } from './dataTable'

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
})
