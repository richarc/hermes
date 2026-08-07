import { describe, it, expect } from 'vitest'
import { buildSpec, canonicalise, readSpec, type BuilderState } from './chartSpec'

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

describe('readSpec', () => {
  it('reports invalid JSON distinctly from an unsupported spec', () => {
    const r = readSpec('{ not json')
    expect(r).toEqual({ ok: false, reason: 'invalid-json' })
  })

  it('refuses a layered spec and names the layer property', () => {
    const r = readSpec(JSON.stringify({ data: { values: [] }, layer: [{ mark: 'line' }] }))
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'unsupported') throw new Error('expected unsupported')
    expect(r.unconsumed).toContain('layer')
  })

  it('refuses a spec with transforms and names transform', () => {
    const spec = {
      data: { values: [{ a: 1 }] },
      transform: [{ filter: 'datum.a > 0' }],
      mark: 'line',
      encoding: {
        x: { field: 'a', type: 'quantitative' },
        y: { field: 'a', type: 'quantitative' },
      },
    }
    const r = readSpec(JSON.stringify(spec))
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'unsupported') throw new Error('expected unsupported')
    expect(r.unconsumed).toContain('transform')
  })

  it('refuses external data and names data', () => {
    const spec = {
      data: { url: 'results.csv' },
      mark: 'line',
      encoding: {
        x: { field: 'a', type: 'quantitative' },
        y: { field: 'b', type: 'quantitative' },
      },
    }
    const r = readSpec(JSON.stringify(spec))
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'unsupported') throw new Error('expected unsupported')
    expect(r.unconsumed).toContain('data')
  })

  it('refuses a mark the builder cannot express', () => {
    const spec = {
      data: { values: [{ a: 1 }] },
      mark: 'arc',
      encoding: {
        x: { field: 'a', type: 'quantitative' },
        y: { field: 'a', type: 'quantitative' },
      },
    }
    const r = readSpec(JSON.stringify(spec))
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'unsupported') throw new Error('expected unsupported')
    expect(r.unconsumed).toContain('mark')
  })

  it('refuses a hand-set title of null, which is not the same as no title', () => {
    const spec = {
      data: { values: [{ a: 1 }] },
      mark: 'line',
      encoding: {
        x: { field: 'a', type: 'quantitative', title: null },
        y: { field: 'a', type: 'quantitative' },
      },
    }
    const r = readSpec(JSON.stringify(spec))
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'unsupported') throw new Error('expected unsupported')
    expect(r.unconsumed).toContain('encoding.x.title')
  })

  it('does not descend into the data array when reporting differences', () => {
    const spec = {
      data: { values: [{ a: 1 }] },
      layer: [],
      mark: 'line',
      encoding: {
        x: { field: 'a', type: 'quantitative' },
        y: { field: 'a', type: 'quantitative' },
      },
    }
    const r = readSpec(JSON.stringify(spec))
    if (r.ok || r.reason !== 'unsupported') throw new Error('expected unsupported')
    expect(r.unconsumed.some((p) => p.startsWith('data.values.'))).toBe(false)
  })

  it('accepts a spec the builder itself would produce', () => {
    const r = readSpec(buildSpec(BASE))
    expect(r.ok).toBe(true)
  })

  it('accepts a hand-edited title, because that edit is inside the model', () => {
    const s = { ...BASE, y: { ...BASE.y, title: 'Mean response' } }
    const r = readSpec(buildSpec(s))
    if (!r.ok) throw new Error('expected ok')
    expect(r.state.y.title).toBe('Mean response')
  })

  // The property that catches buildSpec and readSpec drifting apart.
  //
  // This compares against canonicalise(s), not s itself: readSpec always
  // returns canonical state, and a `count` aggregate with a field set is
  // non-canonical by construction (see canonicalise's doc comment), so its
  // field cannot come back. The extra count-with-field case below is what
  // actually exercises that: every other state here is already canonical, so
  // canonicalise(s) equals s for it and the assertion is unchanged from a
  // plain round-trip.
  it('round-trips every builder state back to its canonical form', () => {
    const states: BuilderState[] = [
      BASE,
      { ...BASE, mark: 'bar' },
      { ...BASE, mark: 'boxplot' },
      { ...BASE, x: { ...BASE.x, title: 'Dose' } },
      { ...BASE, y: { ...BASE.y, title: 'Response', aggregate: 'mean' } },
      { ...BASE, y: { ...BASE.y, aggregate: 'median' } },
      { ...BASE, y: { ...BASE.y, aggregate: 'sum' } },
      { ...BASE, y: { ...BASE.y, field: '', aggregate: 'count' } },
      { ...BASE, y: { ...BASE.y, field: 'response', aggregate: 'count' } },
      { ...BASE, colour: { field: 'group', type: 'nominal' } },
      { ...BASE, x: { field: 'when', type: 'temporal', title: '' } },
      { ...BASE, rows: [] },
    ]
    for (const s of states) {
      const r = readSpec(buildSpec(s))
      if (!r.ok) throw new Error(`refused its own output for ${JSON.stringify(s)}`)
      expect(r.state).toEqual(canonicalise(s))
    }
  })
})
