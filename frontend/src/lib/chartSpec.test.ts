import { describe, it, expect } from 'vitest'
import { buildSpec, canonicalise, readSpec, type BuilderState } from './chartSpec'

const BASE: BuilderState = {
  chartType: 'line',
  rows: [
    { dose: 0, response: 1.5 },
    { dose: 5, response: 3.25 },
  ],
  x: { field: 'dose', type: 'quantitative', title: '' },
  y: { field: 'response', type: 'quantitative', title: '', aggregate: 'none' },
  colour: null,
  extent: 'ci',
  extras: {},
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

  it('emits every plain chart type as its own mark', () => {
    for (const chartType of ['line', 'bar', 'point', 'area', 'boxplot', 'tick', 'rule'] as const) {
      expect(parsed({ ...BASE, chartType }).mark).toBe(chartType)
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

  // Important finding: diffPaths reported paths on BOTH sides of the diff —
  // including ones that exist only because rebuilding the candidate always
  // introduces top-level `mark`/`encoding`, even when the user's original
  // layered spec has neither. Sorted alphabetically, `encoding` landed first,
  // so the refusal read "That chart uses encoding and layer" for a spec with
  // no top-level `encoding` at all. Only paths present on the ORIGINAL spec
  // may be reported now.
  it('refuses a layered spec without naming encoding, which the original spec does not have', () => {
    const r = readSpec(JSON.stringify({ data: { values: [] }, layer: [{ mark: 'line' }] }))
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'unsupported') throw new Error('expected unsupported')
    expect(r.unconsumed).toContain('layer')
    expect(r.unconsumed).not.toContain('encoding')
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

  // Same rebuild-artefact trap as the layered case above, on the other
  // property that always reappears on rebuild: a spec with `transform` and no
  // top-level `encoding` must not be told it "uses encoding".
  it('refuses transform without encoding, on a spec with no top-level encoding', () => {
    const spec = { data: { values: [] }, transform: [{ filter: 'true' }], mark: 'line' }
    const r = readSpec(JSON.stringify(spec))
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'unsupported') throw new Error('expected unsupported')
    expect(r.unconsumed).toContain('transform')
    expect(r.unconsumed).not.toContain('encoding')
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

  describe('row validation', () => {
    // Each of these is Array.isArray-true but not every entry is a plain
    // object of string | number values, so casting the array straight into
    // BuilderState.rows would produce state that violates its own type.
    // Instead of casting, readSpec must fail to reproduce the original
    // "values" array (since it can't represent these rows), leaving them out
    // of the candidate and refusing via the same by-construction path as any
    // other unsupported spec.
    const invalidValues: Record<string, unknown> = {
      'bare numbers': [1, 2, 3],
      'a null entry': [null],
      'bare strings': ['a', 'b'],
      'a nested array': [[1, 2]],
      'a nested object value': [{ a: { deep: 1 } }],
    }

    for (const [label, values] of Object.entries(invalidValues)) {
      it(`refuses rows containing ${label}`, () => {
        const spec = {
          data: { values },
          mark: 'line',
          encoding: {
            x: { field: 'a', type: 'quantitative' },
            y: { field: 'a', type: 'quantitative' },
          },
        }
        const r = readSpec(JSON.stringify(spec))
        expect(r.ok).toBe(false)
        if (r.ok || r.reason !== 'unsupported') throw new Error('expected unsupported')
        expect(r.unconsumed).toContain('data.values')
      })
    }

    it('still accepts a normal row array', () => {
      const r = readSpec(buildSpec(BASE))
      expect(r.ok).toBe(true)
    })
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
  it('carries inert top-level metadata through unchanged', () => {
    // A description is the single most common thing a hand-written chart
    // carries, and refusing the whole chart over one would make the builder
    // useless on any spec a human had written first.
    const spec = {
      description: 'Recovered sources by condition',
      data: { values: [{ a: 1 }] },
      mark: 'bar',
      encoding: {
        x: { field: 'a', type: 'quantitative' },
        y: { field: 'a', type: 'quantitative' },
      },
    }
    const r = readSpec(JSON.stringify(spec))
    if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`)
    expect(r.state.extras).toEqual({ description: 'Recovered sources by condition' })
    expect(JSON.parse(buildSpec(r.state)).description).toBe('Recovered sources by condition')
  })

  it('writes metadata ahead of the data, where a human would put it', () => {
    const text = buildSpec({ ...BASE, extras: { description: 'A chart' } })
    expect(text.indexOf('"description"')).toBeLessThan(text.indexOf('"data"'))
  })

  it('still refuses a property that is unmodelled AND not inert', () => {
    // The allowlist is the point: carrying `transform` through would emit it
    // beside the mark/encoding pair, which is not a valid spec.
    const spec = {
      description: 'has both',
      data: { values: [{ a: 1 }] },
      transform: [{ filter: 'true' }],
      mark: 'bar',
      encoding: {
        x: { field: 'a', type: 'quantitative' },
        y: { field: 'a', type: 'quantitative' },
      },
    }
    const r = readSpec(JSON.stringify(spec))
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'unsupported') throw new Error('expected unsupported')
    expect(r.unconsumed).toContain('transform')
    expect(r.unconsumed).not.toContain('description')
  })

  it('round-trips every builder state back to its canonical form', () => {
    const states: BuilderState[] = [
      BASE,
      { ...BASE, chartType: 'bar' },
      { ...BASE, chartType: 'boxplot' },
      // tick and rule fit the existing x/y encoding shape exactly, which is
      // the whole reason they were cheap to add — if either ever needed a
      // shape of its own, this round trip is what would catch it.
      { ...BASE, chartType: 'tick' },
      { ...BASE, chartType: 'rule' },
      { ...BASE, x: { ...BASE.x, title: 'Dose' } },
      { ...BASE, extras: { description: 'Recovered sources by condition' } },
      { ...BASE, extras: { $schema: 'https://vega.github.io/schema/vega-lite/v6.json' } },
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

describe('backward compatibility', () => {
  // A literal spec string, deliberately NOT one produced by buildSpec: a
  // rebuilt fixture would keep agreeing with buildSpec however buildSpec
  // changed, which is exactly the regression this is here to catch. Every
  // chart in every existing document depends on this reading unchanged.
  const SHIPPED = `{
  "data": {
    "values": [
      {
        "dose": 0,
        "response": 1.5
      }
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": {
      "field": "dose",
      "type": "quantitative"
    },
    "y": {
      "field": "response",
      "type": "quantitative",
      "aggregate": "mean"
    }
  }
}`

  it('reopens a chart written by the previous builder', () => {
    const r = readSpec(SHIPPED)
    if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`)
    expect(r.state.chartType).toBe('bar')
    expect(r.state.x.field).toBe('dose')
    expect(r.state.y.aggregate).toBe('mean')
  })

  it('rebuilds it byte-identically', () => {
    const r = readSpec(SHIPPED)
    if (!r.ok) throw new Error('refused')
    expect(buildSpec(r.state)).toBe(SHIPPED)
  })
})

describe('histogram', () => {
  const HIST: BuilderState = {
    ...BASE,
    chartType: 'histogram',
    x: { field: 'mass', type: 'quantitative', title: '' },
    y: { field: '', type: 'quantitative', title: '', aggregate: 'count' },
  }

  it('bins x and counts rows', () => {
    const s = parsed(HIST)
    expect(s.mark).toBe('bar')
    expect(s.encoding.x).toEqual({ field: 'mass', bin: true, type: 'quantitative' })
    expect(s.encoding.y).toEqual({ aggregate: 'count', type: 'quantitative' })
  })

  it('round-trips', () => {
    const r = readSpec(buildSpec(HIST))
    if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`)
    expect(r.state).toEqual(canonicalise(HIST))
  })

  // The precedence rung that matters most: a plain bar chart that happens to
  // count rows is still a bar chart. Getting this wrong silently retypes
  // charts in documents people have already written.
  it('does not claim a counting bar chart that has no bin', () => {
    const bar: BuilderState = {
      ...BASE,
      chartType: 'bar',
      y: { field: '', type: 'quantitative', title: '', aggregate: 'count' },
    }
    const r = readSpec(buildSpec(bar))
    if (!r.ok) throw new Error('refused')
    expect(r.state.chartType).toBe('bar')
  })
})

describe('error bars', () => {
  const ERR: BuilderState = { ...BASE, chartType: 'errorbar', extent: 'ci' }

  it('emits a mark object carrying the extent', () => {
    expect(parsed(ERR).mark).toEqual({ type: 'errorbar', extent: 'ci' })
  })

  it('round-trips each extent', () => {
    for (const extent of ['ci', 'stderr', 'stdev', 'iqr'] as const) {
      const r = readSpec(buildSpec({ ...ERR, extent }))
      if (!r.ok) throw new Error(`refused ${extent}`)
      expect(r.state.extent).toBe(extent)
      expect(r.state.chartType).toBe('errorbar')
    }
  })

  it('refuses a mark object it cannot model', () => {
    const spec = JSON.stringify({
      data: { values: [{ a: 1 }] },
      mark: { type: 'bar', cornerRadius: 4 },
      encoding: { x: { field: 'a', type: 'quantitative' }, y: { field: 'a', type: 'quantitative' } },
    })
    expect(readSpec(spec).ok).toBe(false)
  })
})

describe('heatmap', () => {
  const HEAT: BuilderState = {
    ...BASE,
    chartType: 'heatmap',
    x: { field: 'day', type: 'nominal', title: '' },
    y: { field: 'hour', type: 'nominal', title: '', aggregate: 'none' },
    colour: { field: 'rate', type: 'quantitative', aggregate: 'mean' },
  }

  it('puts the value on colour, with its aggregate', () => {
    const s = parsed(HEAT)
    expect(s.mark).toBe('rect')
    expect(s.encoding.color).toEqual({ field: 'rate', type: 'quantitative', aggregate: 'mean' })
  })

  it('round-trips', () => {
    const r = readSpec(buildSpec(HEAT))
    if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`)
    expect(r.state).toEqual(canonicalise(HEAT))
  })

  // A rect whose colour groups rather than measures is not a heatmap.
  // Refusing beats guessing: the builder cannot model it either way.
  it('refuses a rect whose colour is nominal', () => {
    const spec = JSON.stringify({
      data: { values: [{ a: 1 }] },
      mark: 'rect',
      encoding: {
        x: { field: 'a', type: 'nominal' },
        y: { field: 'a', type: 'nominal' },
        color: { field: 'a', type: 'nominal' },
      },
    })
    expect(readSpec(spec).ok).toBe(false)
  })
})

describe('pie', () => {
  const PIE: BuilderState = {
    ...BASE,
    chartType: 'pie',
    x: { field: '', type: 'nominal', title: '' },
    y: { field: 'count', type: 'quantitative', title: '', aggregate: 'none' },
    colour: { field: 'category', type: 'nominal' },
  }

  it('emits theta and colour and no x or y', () => {
    const s = parsed(PIE)
    expect(s.mark).toBe('arc')
    expect(s.encoding.theta).toEqual({ field: 'count', type: 'quantitative' })
    expect(s.encoding.color).toEqual({ field: 'category', type: 'nominal' })
    expect(s.encoding.x).toBeUndefined()
    expect(s.encoding.y).toBeUndefined()
  })

  it('round-trips', () => {
    const r = readSpec(buildSpec(PIE))
    if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`)
    expect(r.state).toEqual(canonicalise(PIE))
  })

  it('refuses an arc with no theta', () => {
    const spec = JSON.stringify({
      data: { values: [{ a: 1 }] },
      mark: 'arc',
      encoding: { color: { field: 'a', type: 'nominal' } },
    })
    expect(readSpec(spec).ok).toBe(false)
  })
})
