import { describe, it, expect } from 'vitest'
import { parsePipeTable, serializePipeTable, type PipeTable } from './pipeTable'

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

describe('serializePipeTable', () => {
  it('pads every column to its widest cell', () => {
    const out = serializePipeTable({
      header: ['Name', 'N'],
      align: [null, null],
      rows: [['Alice', '1'], ['Bob', '12']],
    })
    expect(out).toBe(
      ['| Name  | N   |', '| ----- | --- |', '| Alice | 1   |', '| Bob   | 12  |'].join('\n'),
    )
  })

  it('writes alignment markers and keeps the delimiter at least three wide', () => {
    const out = serializePipeTable({
      header: ['a', 'b', 'c'],
      align: ['left', 'center', 'right'],
      rows: [['1', '2', '3']],
    })
    expect(out).toBe(['| a   | b   | c   |', '| :-- | :-: | --: |', '| 1   | 2   | 3   |'].join('\n'))
  })

  it('escapes a pipe inside a cell', () => {
    const out = serializePipeTable({ header: ['a'], align: [null], rows: [['x | y']] })
    expect(out.split('\n')[2]).toBe('| x \\| y |')
  })

  it('measures width in code points', () => {
    const out = serializePipeTable({ header: ['é'], align: [null], rows: [['ab']] })
    expect(out.split('\n')[0]).toBe('| é   |')
    expect(out.split('\n')[2]).toBe('| ab  |')
  })

  it('writes a header-only table', () => {
    expect(serializePipeTable({ header: ['a'], align: [null], rows: [] })).toBe('| a   |\n| --- |')
  })

  it('does not end with a newline', () => {
    expect(serializePipeTable({ header: ['a'], align: [null], rows: [] })).not.toMatch(/\n$/)
  })
})

describe('round trips', () => {
  const table: PipeTable = {
    header: ['Name', 'Score', 'Note'],
    align: ['left', 'right', null],
    rows: [['Alice', '9', 'a \\| b'], ['Bob', '10', '**bold** [@key]']],
  }

  it('parse(serialize(t)) is t', () => {
    // The cell text is raw source, so the escaped pipe survives as written.
    const r = parsePipeTable(serializePipeTable(table))
    expect(r).toEqual({ ok: true, table })
  })

  it('serialize(parse(text)) is text for text this module wrote', () => {
    const text = serializePipeTable(table)
    const r = parsePipeTable(text)
    expect(r.ok && serializePipeTable(r.table)).toBe(text)
  })
})
