import { describe, it, expect } from 'vitest'
import { parsePipeTable } from './pipeTable'

describe('parsePipeTable', () => {
  it('parses a plain table with leading and trailing pipes', () => {
    const r = parsePipeTable('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |')
    expect(r).toEqual({
      ok: true,
      table: { header: ['a', 'b'], align: [null, null], rows: [['1', '2'], ['3', '4']] },
    })
  })

  it('parses a table without outer pipes', () => {
    const r = parsePipeTable('a | b\n--- | ---\n1 | 2')
    expect(r.ok && r.table.header).toEqual(['a', 'b'])
    expect(r.ok && r.table.rows).toEqual([['1', '2']])
  })

  it('reads every alignment form', () => {
    const r = parsePipeTable('| a | b | c | d |\n|:---|:---:|---:|---|\n| 1 | 2 | 3 | 4 |')
    expect(r.ok && r.table.align).toEqual(['left', 'center', 'right', null])
  })

  it('unescapes \\| inside a cell', () => {
    const r = parsePipeTable('| a |\n| --- |\n| x \\| y |')
    expect(r.ok && r.table.rows).toEqual([['x | y']])
  })

  it('pads short rows and truncates long ones to the header width', () => {
    const r = parsePipeTable('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |')
    expect(r.ok && r.table.rows).toEqual([['1', ''], ['1', '2']])
  })

  it('ignores surrounding blank lines and a header-only table is fine', () => {
    const r = parsePipeTable('\n\n| a |\n| --- |\n\n')
    expect(r).toEqual({ ok: true, table: { header: ['a'], align: [null], rows: [] } })
  })

  it('refuses empty input', () => {
    expect(parsePipeTable('   \n ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('refuses text without a delimiter row on line 2', () => {
    expect(parsePipeTable('| a |\n| 1 |')).toEqual({ ok: false, reason: 'no-delimiter' })
    expect(parsePipeTable('just prose')).toEqual({ ok: false, reason: 'no-delimiter' })
  })
})
