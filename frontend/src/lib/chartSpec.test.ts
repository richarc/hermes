import { describe, it, expect } from 'vitest'
import { buildSpec, canonicalise, type BuilderState } from './chartSpec'

const BASE: BuilderState = {
  mark: 'line',
  rows: [
    { dose: 0, response: 1.5 },
    { dose: 5, response: 3.25 },
  ],
  x: { field: 'dose', type: 'quantitative', title: '' },
  y: { field: 'response', type: 'quantitative', title: '', aggregate: 'none' },
  colour: null,
}

const parsed = (s: BuilderState) => JSON.parse(buildSpec(s))

describe('buildSpec', () => {
  it('produces data, mark, and x/y encodings', () => {
    expect(parsed(BASE)).toEqual({
      data: { values: BASE.rows },
      mark: 'line',
      encoding: {
        x: { field: 'dose', type: 'quantitative' },
        y: { field: 'response', type: 'quantitative' },
      },
    })
  })

  it('emits every mark verbatim', () => {
    for (const mark of ['line', 'bar', 'point', 'area', 'boxplot'] as const) {
      expect(parsed({ ...BASE, mark }).mark).toBe(mark)
    }
  })

  it('omits a title that is empty, so Vega-Lite falls back to the field name', () => {
    expect(parsed(BASE).encoding.x.title).toBeUndefined()
  })

  it('emits a title that is set', () => {
    const s = { ...BASE, x: { ...BASE.x, title: 'Dose (mg/kg)' } }
    expect(parsed(s).encoding.x.title).toBe('Dose (mg/kg)')
  })

  it('omits the aggregate when it is none', () => {
    expect(parsed(BASE).encoding.y.aggregate).toBeUndefined()
  })

  it('emits the aggregate when one is chosen', () => {
    const s = { ...BASE, y: { ...BASE.y, aggregate: 'mean' as const } }
    expect(parsed(s).encoding.y).toEqual({
      field: 'response',
      type: 'quantitative',
      aggregate: 'mean',
    })
  })

  it('drops the field for a count aggregate, which Vega-Lite counts rows for', () => {
    const s = { ...BASE, y: { ...BASE.y, aggregate: 'count' as const } }
    expect(parsed(s).encoding.y).toEqual({ aggregate: 'count', type: 'quantitative' })
  })

  it('emits a colour encoding under Vega-Lite’s spelling', () => {
    const s = { ...BASE, colour: { field: 'group', type: 'nominal' as const } }
    expect(parsed(s).encoding.color).toEqual({ field: 'group', type: 'nominal' })
  })

  it('omits colour entirely when there is none', () => {
    expect(parsed(BASE).encoding.color).toBeUndefined()
  })

  it('formats with a two-space indent, matching the sample document', () => {
    expect(buildSpec(BASE)).toContain('\n  "mark": "line"')
  })

  it('does not emit $schema, which no existing document carries', () => {
    expect(buildSpec(BASE)).not.toContain('$schema')
  })
})

describe('canonicalise', () => {
  it('clears the field and forces type quantitative for a count aggregate', () => {
    const s = { ...BASE, y: { ...BASE.y, field: 'response', aggregate: 'count' as const } }
    expect(canonicalise(s).y).toEqual({
      field: '',
      type: 'quantitative',
      title: '',
      aggregate: 'count',
    })
  })

  it('returns other states unchanged, by identity', () => {
    expect(canonicalise(BASE)).toBe(BASE)
  })

  it('maps two states that differ only by y.field under a count aggregate to the same canonical value', () => {
    const withField = { ...BASE, y: { ...BASE.y, field: 'response', aggregate: 'count' as const } }
    const withoutField = { ...BASE, y: { ...BASE.y, field: '', aggregate: 'count' as const } }
    expect(canonicalise(withField)).toEqual(canonicalise(withoutField))
    expect(buildSpec(withField)).toBe(buildSpec(withoutField))
  })
})
