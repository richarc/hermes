# More Chart Types in the Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add histogram, heatmap, error bar and pie charts to the graphical chart builder, behind a single "Chart type" dropdown.

**Architecture:** The chart type is *derived* from the spec, never stored, so a chart stays a plain portable Vega-Lite block. `BuilderState` keeps one flat shape; `buildSpec` branches on the type to decide which channels to emit; `readSpec` gains an inference ladder and otherwise still derives-rebuilds-compares. `ChartBuilder.svelte` shows only the controls the chosen type needs.

**Tech Stack:** Svelte 5, TypeScript, Vega-Lite 6, Vitest + jsdom.

## Global Constraints

- The design this implements is `docs/superpowers/specs/2026-08-22-chart-types-design.md`. Where this plan and that document disagree, the design wins.
- **The round trip is the contract.** `readSpec` decides editability by deriving a candidate, rebuilding it with `buildSpec` and comparing. Any new type that does not rebuild byte-identically cannot be reopened. Write the round-trip case before the implementation, every time.
- **Every chart in every existing document must reopen exactly as it does today.** A `bar` with a `count` aggregate and no `bin` is still Bar, not Histogram.
- **Inference order is load-bearing**, most specific first: errorbar object → arc+theta → rect+quantitative colour → bar+x.bin → plain mark name → refuse.
- `PASSTHROUGH_KEYS` still excludes `layer`, `transform` and `facet`. Nothing here may add them.
- No literal colours in `style.css`; `styleContract.test.ts` fails the build on one.
- Tests: `cd frontend && npx vitest run <file>`. Full check: `cd frontend && npm test && npm run check`.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/chartSpec.ts` | Type vocabulary, state, `buildSpec` branching, the inference ladder |
| `frontend/src/lib/chartSpec.test.ts` | Round trips, inference precedence, backward compatibility |
| `frontend/src/ChartBuilder.svelte` | Chart type dropdown, adaptive form, per-type readiness and labels |
| `frontend/src/ChartBuilder.test.ts` | Form adaptation, readiness, selection survival |
| `docs/test-document.md` | One fixture per new type |
| `CHANGELOG.md`, `ROADMAP.md` | Record it |

---

### Task 1: The vocabulary, and renaming `mark` to `chartType`

A pure refactor. No new chart type works at the end of it; every existing one behaves identically. Doing it alone keeps the rename out of the diffs that add behaviour.

**Files:**
- Modify: `frontend/src/lib/chartSpec.ts` (lines 1-73)
- Modify: `frontend/src/ChartBuilder.svelte` (the `mark` variable and its uses)
- Test: `frontend/src/lib/chartSpec.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ChartType`, `CHART_TYPES`, `Extent`, `EXTENTS`, and `BuilderState.chartType` replacing `BuilderState.mark`. Every later task builds on these names.

- [ ] **Step 1: Write the backward-compatibility test first**

This is the test that must never break for the rest of the plan. Append to `frontend/src/lib/chartSpec.test.ts`:

```ts
describe('backward compatibility', () => {
  // A literal spec string, deliberately NOT one produced by buildSpec: a
  // rebuilt fixture would keep agreeing with buildSpec however buildSpec
  // changed, which is exactly the regression this is here to catch.
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest run src/lib/chartSpec.test.ts`
Expected: FAIL — `r.state.chartType` is undefined, because the field is still called `mark`.

- [ ] **Step 3: Add the vocabulary**

Replace the `Mark`/`MARKS` block at the top of `frontend/src/lib/chartSpec.ts` with:

```ts
/**
 * What the author picks in the builder. NOT a Vega-Lite mark: `histogram`,
 * `heatmap`, `errorbar` and `pie` each name a whole encoding shape, and the
 * mark they emit is derived. The type itself is never written into the spec —
 * readSpec infers it back, which is what keeps a chart block plain,
 * portable Vega-Lite with no Hermes marker in it.
 */
export type ChartType =
  | 'line'
  | 'bar'
  | 'point'
  | 'area'
  | 'boxplot'
  | 'tick'
  | 'rule'
  | 'histogram'
  | 'heatmap'
  | 'errorbar'
  | 'pie'

export const CHART_TYPES: readonly ChartType[] = [
  'line',
  'bar',
  'point',
  'area',
  'boxplot',
  'tick',
  'rule',
  'histogram',
  'heatmap',
  'errorbar',
  'pie',
]

/**
 * The types whose name is also the Vega-Lite mark, with no shape of their own.
 * Adding one that fits the plain x/y/colour shape is still a one-line change;
 * anything else needs a branch in buildSpec and a rung on the inference ladder
 * in readSpec.
 *
 * `tick` draws a short stroke at each point, which is a strip plot. `rule`
 * draws a line from the baseline up to each point — a spike or stem plot, NOT
 * the horizontal reference line the name suggests.
 */
const PLAIN_MARKS = ['line', 'bar', 'point', 'area', 'boxplot', 'tick', 'rule'] as const

/** How far an error bar reaches. Vega-Lite's own vocabulary. */
export type Extent = 'ci' | 'stderr' | 'stdev' | 'iqr'
export const EXTENTS: readonly Extent[] = ['ci', 'stderr', 'stdev', 'iqr']
```

- [ ] **Step 4: Widen the state**

In the same file, change `Encoding`'s neighbours and `BuilderState`:

```ts
/**
 * A colour channel. For most charts this groups rows and carries no quantity,
 * which is why `aggregate` is optional — a heatmap is the exception, where
 * colour *is* the value being plotted.
 */
export interface ColourEncoding {
  field: string
  type: FieldType
  aggregate?: Aggregate
}

export interface BuilderState {
  chartType: ChartType
  rows: Record<string, string | number>[]
  x: Encoding
  /** For a pie this is the slice size — Vega-Lite's `theta`. */
  y: ValueEncoding
  /** For a heatmap this is the value; for a pie, the category. */
  colour: ColourEncoding | null
  /** Error bars only; ignored and never emitted by every other type. */
  extent: Extent
  /** Inert top-level properties preserved verbatim across a round trip. */
  extras: Record<string, unknown>
}
```

- [ ] **Step 5: Rename at every use**

Run: `cd frontend && grep -rn "\bmark\b" src/lib/chartSpec.ts src/ChartBuilder.svelte src/lib/chartSpec.test.ts src/ChartBuilder.test.ts`

Change `state.mark` → `state.chartType` in `buildSpec`, `parsed.mark` handling in `readSpec` (keep reading the spec's `mark` key — only the *state field* is renamed), and in `ChartBuilder.svelte` rename the local `mark` variable to `chartType` along with `MARKS` → `CHART_TYPES` in its import and its `{#each}`. Seed `extent: 'ci'` and give `colour` its optional aggregate wherever `BuilderState` is constructed.

In `readSpec`, the candidate's type check becomes:

```ts
    chartType: (PLAIN_MARKS as readonly string[]).includes(String(parsed.mark))
      ? (parsed.mark as ChartType)
      : 'line',
```

Leave the rest of `readSpec` alone — the inference ladder is Task 2 and Task 3.

- [ ] **Step 6: Run everything**

Run: `cd frontend && npm test && npm run check`
Expected: all tests pass including the two new ones; 0 type errors. The dropdown still lists seven types because only `PLAIN_MARKS` is reachable so far — that is correct at this stage.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/chartSpec.ts frontend/src/lib/chartSpec.test.ts frontend/src/ChartBuilder.svelte
git commit -m "refactor: BuilderState carries a chart type, not a mark"
```

---

### Task 2: Histogram and error bars

Both keep the x/y shape, so they land together.

**Files:**
- Modify: `frontend/src/lib/chartSpec.ts` (`buildSpec`, `readSpec`)
- Test: `frontend/src/lib/chartSpec.test.ts`

**Interfaces:**
- Consumes: `ChartType`, `Extent`, `BuilderState.chartType`, `BuilderState.extent` (Task 1).
- Produces: `markFor(state)` and the first two rungs of the inference ladder, both used by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/chartSpec.test.ts`:

```ts
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
  // existing documents.
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
    const r = readSpec(spec)
    expect(r.ok).toBe(false)
  })
})
```

`BASE` in that file needs `chartType: 'line'` and `extent: 'ci'` added by Task 1; if it still says `mark`, Task 1 was left incomplete.

- [ ] **Step 2: Run and watch them fail**

Run: `cd frontend && npx vitest run src/lib/chartSpec.test.ts`
Expected: FAIL — the histogram emits `mark: "histogram"` with no `bin`, and the errorbar emits a bare string.

- [ ] **Step 3: Branch `buildSpec`**

In `frontend/src/lib/chartSpec.ts`, add above `buildSpec`:

```ts
/**
 * The Vega-Lite mark a chart type emits. Most are their own name; the four
 * shaped types map onto a mark the author never has to know about.
 */
function markFor(state: BuilderState): unknown {
  switch (state.chartType) {
    case 'histogram':
      return 'bar'
    case 'heatmap':
      return 'rect'
    case 'pie':
      return 'arc'
    case 'errorbar':
      return { type: 'errorbar', extent: state.extent }
    default:
      return state.chartType
  }
}
```

In `canonicalise`, force the histogram's y before anything else reads it — a histogram always counts, and its y field is never emitted:

```ts
export function canonicalise(state: BuilderState): BuilderState {
  const forced: BuilderState =
    state.chartType === 'histogram'
      ? { ...state, y: { ...state.y, field: '', type: 'quantitative', aggregate: 'count' } }
      : state
  if (forced.y.aggregate !== 'count') return forced
  return { ...forced, y: { ...forced.y, field: '', type: 'quantitative' } }
}
```

In `buildSpec`, add `bin` to x for a histogram, and use `markFor`:

```ts
  const x: Record<string, unknown> = { field: state.x.field, type: state.x.type }
  if (state.chartType === 'histogram') x.bin = true
  if (state.x.title !== '') x.title = state.x.title
```

and replace `mark: state.mark` in the returned object with `mark: markFor(state)`.

**Key order matters** — `buildSpec` emits `{field, bin, type, title?}` for a histogram's x, so `readSpec` must rebuild in that order or `deepEqual` will still pass (it is key-order independent) but the committed text will churn. Emit `bin` immediately after `field`, as above.

- [ ] **Step 4: Add the inference ladder**

In `readSpec`, replace the candidate's `chartType` line with a call to a new function, defined above `readSpec`:

```ts
/**
 * Which chart type a parsed spec represents, or null to refuse.
 *
 * Order is load-bearing: most specific first. A bar chart that counts rows but
 * does not bin is a bar chart, not a histogram — every chart in every existing
 * document depends on that.
 */
function inferChartType(parsed: Record<string, unknown>): ChartType | null {
  const mark = parsed.mark
  const enc = isPlainObject(parsed.encoding) ? parsed.encoding : {}

  if (isPlainObject(mark)) {
    // The only mark object the builder models is an error bar with an extent.
    if (mark.type === 'errorbar' && (EXTENTS as readonly unknown[]).includes(mark.extent)) {
      return 'errorbar'
    }
    return null
  }
  if (mark === 'arc' && isPlainObject(enc.theta)) return 'pie'
  if (mark === 'rect' && isPlainObject(enc.color) && enc.color.type === 'quantitative') {
    return 'heatmap'
  }
  if (mark === 'bar' && isPlainObject(enc.x) && enc.x.bin === true) return 'histogram'
  if ((PLAIN_MARKS as readonly unknown[]).includes(mark)) return mark as ChartType
  return null
}
```

and in the candidate:

```ts
    chartType: inferChartType(parsed) ?? 'line',
```

Read the extent alongside it:

```ts
  const markObj = isPlainObject(parsed.mark) ? parsed.mark : {}
  const extent = (EXTENTS as readonly unknown[]).includes(markObj.extent)
    ? (markObj.extent as Extent)
    : 'ci'
```

A spec `inferChartType` rejects still reaches the rebuild-and-compare and is refused there, with the differing paths reported — no separate refusal branch is needed, and that keeps one mechanism deciding editability.

- [ ] **Step 5: Run the tests**

Run: `cd frontend && npm test && npm run check`
Expected: all pass, including the Task 1 backward-compatibility pair.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/chartSpec.ts frontend/src/lib/chartSpec.test.ts
git commit -m "feat: histogram and error bar chart types"
```

---

### Task 3: Heatmap and pie

**Files:**
- Modify: `frontend/src/lib/chartSpec.ts` (`buildSpec`, `readSpec`)
- Test: `frontend/src/lib/chartSpec.test.ts`

**Interfaces:**
- Consumes: `markFor`, `inferChartType`, `ColourEncoding` (Tasks 1-2).
- Produces: nothing later tasks rely on beyond working types.

- [ ] **Step 1: Write the failing tests**

```ts
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

  // A rect with a grouping colour is not a heatmap; refusing beats guessing.
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd frontend && npx vitest run src/lib/chartSpec.test.ts`
Expected: FAIL — pie still emits x and y; heatmap's colour carries no aggregate.

- [ ] **Step 3: Branch the encoding in `buildSpec`**

Replace the encoding assembly in `buildSpec` with:

```ts
  const encoding: Record<string, unknown> = {}
  if (state.chartType === 'pie') {
    // A pie has no x or y: the slice size is `theta` (held in state.y) and
    // the category is the colour. See the design note on why BuilderState
    // reuses those fields rather than becoming a discriminated union.
    const theta: Record<string, unknown> = { field: state.y.field, type: state.y.type }
    if (state.y.aggregate !== 'none' && state.y.aggregate !== 'count') {
      theta.aggregate = state.y.aggregate
    }
    if (state.y.title !== '') theta.title = state.y.title
    encoding.theta = theta
  } else {
    encoding.x = x
    encoding.y = y
  }
  if (state.colour) {
    const colour: Record<string, unknown> = {
      field: state.colour.field,
      type: state.colour.type,
    }
    if (state.colour.aggregate && state.colour.aggregate !== 'none') {
      colour.aggregate = state.colour.aggregate
    }
    encoding.color = colour
  }
```

- [ ] **Step 4: Read colour's aggregate back**

In `readSpec`, replace the colour derivation with one that keeps the aggregate:

```ts
  const rawColour = isPlainObject(enc.color) ? enc.color : null
  const colour: ColourEncoding | null = rawColour
    ? {
        ...(() => {
          const e = readEncoding(rawColour)
          return { field: e.field, type: e.type }
        })(),
        ...((AGGREGATES as readonly string[]).includes(String(rawColour.aggregate))
          ? { aggregate: rawColour.aggregate as Aggregate }
          : {}),
      }
    : null
```

For a pie, the candidate's `y` comes from `theta` rather than `encoding.y`:

```ts
  const rawY = isPlainObject(enc.theta) ? enc.theta : isPlainObject(enc.y) ? enc.y : {}
```

- [ ] **Step 5: Run everything**

Run: `cd frontend && npm test && npm run check`
Expected: all pass. If the pie round trip fails on `x`, check that `canonicalise` is not writing an x field for a type that never emits one.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/chartSpec.ts frontend/src/lib/chartSpec.test.ts
git commit -m "feat: heatmap and pie chart types"
```

---

### Task 4: The builder's adaptive form

**Files:**
- Modify: `frontend/src/ChartBuilder.svelte`
- Test: `frontend/src/ChartBuilder.test.ts`

**Interfaces:**
- Consumes: `CHART_TYPES`, `EXTENTS`, `ChartType`, `Extent`, and the state fields from Tasks 1-3.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/ChartBuilder.test.ts`, matching that file's existing helpers (`select(target, field, value)` and its mount helper):

```ts
describe('chart type form', () => {
  it('offers every chart type', () => {
    const { target } = mountBuilder()
    paste(target, 'day,hour,rate\nMon,9,1\n')
    const options = [...target.querySelectorAll('select[data-field="chart-type"] option')]
    expect(options.map((o) => o.getAttribute('value'))).toContain('histogram')
    expect(options).toHaveLength(11)
  })

  it('hides the Y control for a histogram, whose Y is always the count', () => {
    const { target } = mountBuilder()
    paste(target, 'mass\n1\n2\n')
    select(target, 'chart-type', 'histogram')
    expect(target.querySelector('select[data-field="y"]')).toBeNull()
  })

  it('shows an extent control only for error bars', () => {
    const { target } = mountBuilder()
    paste(target, 'a,b\nx,1\n')
    expect(target.querySelector('select[data-field="extent"]')).toBeNull()
    select(target, 'chart-type', 'errorbar')
    expect(target.querySelector('select[data-field="extent"]')).not.toBeNull()
  })

  it('relabels the value and category controls for a pie', () => {
    const { target } = mountBuilder()
    paste(target, 'category,count\na,1\n')
    select(target, 'chart-type', 'pie')
    expect(target.textContent).toContain('Slice size')
    expect(target.textContent).toContain('Category')
    expect(target.querySelector('select[data-field="x"]')).toBeNull()
  })

  it('requires a colour value for a heatmap', () => {
    const { target } = mountBuilder()
    paste(target, 'day,hour,rate\nMon,9,1\n')
    select(target, 'chart-type', 'heatmap')
    select(target, 'x', 'day')
    select(target, 'y', 'hour')
    expect(insertBtn(target).disabled).toBe(true)
    select(target, 'colour', 'rate')
    expect(insertBtn(target).disabled).toBe(false)
  })

  // The annoyance a naive implementation ships: switching type should not
  // empty a form the author has already filled in.
  it('keeps column selections when the chart type changes', () => {
    const { target } = mountBuilder()
    paste(target, 'dose,response\n0,1\n')
    select(target, 'x', 'dose')
    select(target, 'y', 'response')
    select(target, 'chart-type', 'errorbar')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="x"]')!.value).toBe('dose')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="y"]')!.value).toBe('response')
  })
})
```

The file already defines `mountBuilder()`, `paste(target, text)` and
`select(target, dataField, value)` — reuse them, do not add parallel helpers.
There is no insert-button helper; add one beside the others, since these tests
need it repeatedly:

```ts
/** The dialog's confirming button, whose disabled state is readiness. */
function insertBtn(target: HTMLElement): HTMLButtonElement {
  return [...target.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Insert chart',
  )! as HTMLButtonElement
}
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd frontend && npx vitest run src/ChartBuilder.test.ts`
Expected: FAIL — there is no `chart-type` select; the mark dropdown is still `data-field="mark"`.

- [ ] **Step 3: Replace the mark control**

In `ChartBuilder.svelte`, change the import to `CHART_TYPES`, `EXTENTS`, `type ChartType`, `type Extent`, and replace the mark row in the markup:

```svelte
      <label class="mark-row">Chart type
        <select data-field="chart-type" bind:value={chartType}>
          {#each CHART_TYPES as t (t)}<option value={t}>{t}</option>{/each}
        </select>
      </label>
```

Add `let extent: Extent = $state(seed.extent)` alongside the other controls, seeded `initial?.extent ?? 'ci'`.

- [ ] **Step 4: Make the form adapt**

Add derived flags near `effectiveAggregate`:

```ts
  // Which channels this chart type actually uses. Everything the form hides is
  // a control the author would otherwise have to know to ignore.
  const isPie = $derived(chartType === 'pie')
  const isHistogram = $derived(chartType === 'histogram')
  const isHeatmap = $derived(chartType === 'heatmap')
  const showX = $derived(!isPie)
  const showY = $derived(!isHistogram)
  const showAggregate = $derived(chartType !== 'boxplot' && !isHistogram)
  const valueLabel = $derived(isPie ? 'Slice size' : 'Y')
  const colourLabel = $derived(isPie ? 'Category' : isHeatmap ? 'Value' : 'Colour')
```

Wrap the X block in `{#if showX}`, the Y block in `{#if showY}`, gate the aggregate on `showAggregate`, use `{valueLabel}` and `{colourLabel}` for those labels, and add the extent control:

```svelte
      {#if chartType === 'errorbar'}
        <label>Extent
          <select data-field="extent" bind:value={extent}>
            {#each EXTENTS as e (e)}<option value={e}>{e}</option>{/each}
          </select>
        </label>
      {/if}
```

Add a colour aggregate control shown only when `isHeatmap`, bound to a new `colourAggregate` state seeded from `initial?.colour?.aggregate ?? 'mean'`.

- [ ] **Step 5: Make readiness per-type**

Replace the `ready` derivation:

```ts
  // Each chart type needs different channels filled in; a single rule would
  // either block a histogram that legitimately has no Y, or let a heatmap
  // commit with no value to colour by.
  const ready = $derived.by(() => {
    if (table === null) return false
    const x = xField !== '' && hasColumn(xField)
    const y = effectiveAggregate === 'count' || (yField !== '' && hasColumn(yField))
    const colour = colourField === '' || hasColumn(colourField)
    switch (chartType) {
      case 'histogram':
        return x && colour
      case 'pie':
        return yField !== '' && hasColumn(yField) && colourField !== '' && hasColumn(colourField)
      case 'heatmap':
        return x && y && colourField !== '' && hasColumn(colourField)
      default:
        return x && y && colour
    }
  })
```

Finally, include `chartType`, `extent` and the colour aggregate in `builderState`.

- [ ] **Step 6: Run everything**

Run: `cd frontend && npm test && npm run check`
Expected: all pass, including every pre-existing ChartBuilder test — if one now fails on `data-field="mark"`, update the selector rather than restoring the old name.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ChartBuilder.svelte frontend/src/ChartBuilder.test.ts
git commit -m "feat: the chart builder adapts its form to the chart type"
```

---

### Task 5: Fixtures and records

**Files:**
- Modify: `docs/test-document.md`, `CHANGELOG.md`, `ROADMAP.md`

- [ ] **Step 1: Add a fixture per new type**

In `docs/test-document.md` §7 (Charts), add four `vega-lite` blocks — a histogram, a heatmap, an error bar chart and a pie — each with a `title` so it becomes a numbered figure, and prose in the file's existing voice saying what correct looks like and that **each must reopen in the builder with its controls filled in**. Reopening is the property that no unit test can prove end to end.

- [ ] **Step 2: Changelog**

Under `## [Unreleased]` → `### Added`:

```markdown
- Four more chart types in the builder: **histogram**, **heatmap**, **error
  bars** and **pie**. The Mark dropdown becomes Chart type, and the form shows
  only the controls that type needs — a histogram asks for one column and
  counts the rows, a heatmap asks what the colour means, error bars ask how far
  they reach. The chart type is worked out from the spec rather than recorded
  in it, so a chart block stays plain portable Vega-Lite and existing charts
  reopen exactly as before.
```

- [ ] **Step 3: Tick the roadmap bullet**

Replace the v0.7.0 `- [ ] Support more Vega-Lite chart types in the builder…` bullet with a `- [x]` account of what shipped: the four families, the derived-not-stored type, that the inference ladder runs most-specific-first so a counting bar chart is still a bar chart, and that error bars turned out to be a single mark with an extent rather than the layered chart the entry assumed. Record what remains out of scope — layered charts still need `layer`/`transform` in the round trip, and `circle`/`square`/`trail` are still deliberately skipped.

- [ ] **Step 4: Commit**

```bash
git add docs/test-document.md CHANGELOG.md ROADMAP.md
git commit -m "docs: record the new chart types"
```

---

## Manual check (after Task 5)

`wails3 task build && wails3 task run`, then open `docs/test-document.md`:

1. Each of the four new fixtures renders as the chart it claims to be.
2. Put the cursor in each and Insert → Chart… reopens it with the right chart type selected and its controls filled in. **This is the one that matters** — it exercises the round trip against real specs.
3. Build a histogram from scratch: paste a table, choose Histogram, pick one column, insert.
4. Every existing chart in the document still reopens as it did before.
5. Switching chart type mid-edit keeps the columns already chosen.
