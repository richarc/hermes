# Vega-Lite Chart Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a table, choose a mark and encodings, watch the chart update live, and insert it into the document — then reopen it later to change it.

**Architecture:** Two pure modules do the real work and are tested headlessly: `dataTable.ts` turns pasted or imported text into typed columns and rows, and `chartSpec.ts` holds `buildSpec`/`readSpec` as an inverse pair. `ChartBuilder.svelte` is a modal shell over them, reusing the vega-embed that `charts.ts` already lazy-loads. Go gains one method for the file picker; `menu.go` gains an Insert submenu.

**Tech Stack:** Svelte 5 runes, TypeScript, CodeMirror 6, Vega-Lite 6 via vega-embed, Wails v3 (Go), Vitest + jsdom.

Design: [docs/superpowers/specs/2026-08-06-vega-lite-builder-design.md](../specs/2026-08-06-vega-lite-builder-design.md)

## Global Constraints

- Frontend work is in `frontend/`; `menu.go` and `documentservice.go` are at the repo ROOT. **Use an explicit absolute `cd` in EVERY bash call** — the working directory does not persist between calls. Join commands with `&&`, never `;`, so a failure cannot be masked by a later success.
- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`). No Svelte 4 store syntax.
- Verification from `frontend/`: `npx vitest run`, `npm run check` (must report `0 ERRORS`), `npm run build`. From the repo root: `gofmt -l . | grep -v '^build/'` (must print nothing), `go vet ./.`, `go test ./.`, `go build -o /dev/null .` — note `./.`, not `./...`.
- Baseline before Task 1: **211 frontend tests across 17 files**, Go tests passing.
- **Test counts in this plan are estimates.** Report the actual numbers you observe. Never edit or skip a test to make a count match. If your starting count differs from the one stated in your task, the previous task's actual result is authoritative — say so and continue.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **jsdom has no layout engine and no CSS cascade.** Every rect is 0. Never assert a computed colour, a size, or that a chart rendered. Chart appearance is a manual check.
- Generated JSON is `JSON.stringify(obj, null, 2)` — 2-space indent, matching `docs/sample-paper.md`. Do **not** emit `$schema`; no existing document has one.
- Colour is spelled `colour` in Hermes' own identifiers and `color` in Vega-Lite output. Both spellings are correct in their own domain; do not unify them.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/dataTable.ts` *(new)* | Parse delimited text into typed columns and rows. Pure. |
| `frontend/src/lib/dataTable.test.ts` *(new)* | Headless coverage for the above. |
| `frontend/src/lib/chartSpec.ts` *(new)* | `buildSpec` / `readSpec` inverse pair, plus the `BuilderState` type. Pure. |
| `frontend/src/lib/chartSpec.test.ts` *(new)* | Headless coverage, including the round-trip property. |
| `frontend/src/ChartBuilder.svelte` *(new)* | The modal: data step, encoding controls, live preview. |
| `frontend/src/ChartBuilder.test.ts` *(new)* | jsdom coverage of the mechanical parts. |
| `frontend/src/Editor.svelte` | Gains `enclosingChartBlock()` and `replaceRange()`. |
| `frontend/src/App.svelte` | Modal state, `menu:insert-chart` listener, create-vs-edit dispatch. |
| `documentservice.go` | `ImportData()` and the testable `readDataFile()`. |
| `menu.go` | Insert submenu; move Insert Citation…; add Insert Chart…. |

---

## Task 1: Parse delimited data

**Files:**
- Create: `frontend/src/lib/dataTable.ts`
- Test: `frontend/src/lib/dataTable.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FieldType`, `Column`, `DataTable`, `ParseResult`, `parseDelimited(text: string): ParseResult`. Task 2 imports `FieldType`; Tasks 6 and 7 import `parseDelimited` and `DataTable`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/dataTable.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/dataTable.test.ts
```
Expected: FAIL — cannot resolve `./dataTable`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/dataTable.ts`:

```ts
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
  if (tabs === 0 && commas === 0) {
    return {
      ok: false,
      message: 'Expected a comma- or tab-separated table with a header row.',
    }
  }
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
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/dataTable.test.ts && npm run check
```
Expected: 13 passing, `0 ERRORS`.

- [ ] **Step 5: Run the whole suite**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run
```
Expected: about 224 tests across 18 files.

- [ ] **Step 6: Commit**

```bash
cd /Users/richarc/Development/hermes
git add frontend/src/lib/dataTable.ts frontend/src/lib/dataTable.test.ts
git commit -m "$(cat <<'EOF'
feat: parse pasted or imported delimited data into typed columns

Sniffs comma vs tab from the header, honours quoted fields, and infers
each column as quantitative, temporal, or nominal.

Date detection is a strict ISO pattern rather than Date.parse, which
accepts bare integers in some engines and would type a year column as
temporal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Generate a spec from builder state

**Files:**
- Create: `frontend/src/lib/chartSpec.ts`
- Test: `frontend/src/lib/chartSpec.test.ts`

**Interfaces:**
- Consumes: `FieldType` from `./dataTable`.
- Produces: `Mark`, `Aggregate`, `Encoding`, `ValueEncoding`, `BuilderState`, `buildSpec(state: BuilderState): string`. Task 3 adds `readSpec` to the same file. Tasks 7 and 8 import `BuilderState` and `buildSpec`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/chartSpec.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSpec, type BuilderState } from './chartSpec'

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
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/chartSpec.test.ts
```
Expected: FAIL — cannot resolve `./chartSpec`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/chartSpec.ts`:

```ts
import type { FieldType } from './dataTable'

export type Mark = 'line' | 'bar' | 'point' | 'area' | 'boxplot'
export const MARKS: readonly Mark[] = ['line', 'bar', 'point', 'area', 'boxplot']

export type Aggregate = 'none' | 'mean' | 'median' | 'sum' | 'count'
export const AGGREGATES: readonly Aggregate[] = ['none', 'mean', 'median', 'sum', 'count']

export interface Encoding {
  field: string
  type: FieldType
  /** Empty means "no explicit title", which Vega-Lite fills with the field name. */
  title: string
}

export interface ValueEncoding extends Encoding {
  aggregate: Aggregate
}

export interface BuilderState {
  mark: Mark
  rows: Record<string, string | number>[]
  x: Encoding
  y: ValueEncoding
  colour: { field: string; type: FieldType } | null
}

/**
 * Renders builder state as Vega-Lite spec text.
 *
 * Every optional property is omitted rather than emitted empty, and `readSpec`
 * inverts each omission exactly. That symmetry is what makes the round-trip
 * property in chartSpec.test.ts hold — changing an omission here without
 * changing the matching read there will fail that test, which is the point.
 */
export function buildSpec(state: BuilderState): string {
  const x: Record<string, unknown> = { field: state.x.field, type: state.x.type }
  if (state.x.title !== '') x.title = state.x.title

  // Vega-Lite's `count` counts rows and takes no field, so emitting one would
  // be invalid. readSpec restores the empty field for the same reason.
  const y: Record<string, unknown> =
    state.y.aggregate === 'count'
      ? { aggregate: 'count', type: 'quantitative' }
      : { field: state.y.field, type: state.y.type }
  if (state.y.aggregate !== 'none' && state.y.aggregate !== 'count') {
    y.aggregate = state.y.aggregate
  }
  if (state.y.title !== '') y.title = state.y.title

  const encoding: Record<string, unknown> = { x, y }
  if (state.colour) {
    encoding.color = { field: state.colour.field, type: state.colour.type }
  }

  return JSON.stringify({ data: { values: state.rows }, mark: state.mark, encoding }, null, 2)
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/chartSpec.test.ts && npm run check
```
Expected: 11 passing, `0 ERRORS`.

- [ ] **Step 5: Commit**

```bash
cd /Users/richarc/Development/hermes
git add frontend/src/lib/chartSpec.ts frontend/src/lib/chartSpec.test.ts
git commit -m "$(cat <<'EOF'
feat: render builder state as a Vega-Lite spec

Optional properties are omitted rather than emitted empty, so that
readSpec can invert each omission exactly in the next commit.

Count is special-cased: Vega-Lite counts rows and takes no field, so
emitting one would be invalid.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Read a spec back, or refuse

**Files:**
- Modify: `frontend/src/lib/chartSpec.ts`
- Test: `frontend/src/lib/chartSpec.test.ts`

**Interfaces:**
- Consumes: `buildSpec` and `BuilderState` from Task 2.
- Produces: `ReadResult`, `readSpec(json: string): ReadResult`. Task 8 imports both.

The rule, from the design: derive a candidate state, rebuild from it, and compare. If the rebuild does not match the original, refuse — and report the property paths that differ, so the message can name what it could not handle.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/chartSpec.test.ts`. Add `readSpec` to the existing import from `./chartSpec`:

```ts
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
  it('round-trips every builder state back to itself', () => {
    const states: BuilderState[] = [
      BASE,
      { ...BASE, mark: 'bar' },
      { ...BASE, mark: 'boxplot' },
      { ...BASE, x: { ...BASE.x, title: 'Dose' } },
      { ...BASE, y: { ...BASE.y, title: 'Response', aggregate: 'mean' } },
      { ...BASE, y: { ...BASE.y, aggregate: 'median' } },
      { ...BASE, y: { ...BASE.y, aggregate: 'sum' } },
      { ...BASE, y: { ...BASE.y, field: '', aggregate: 'count' } },
      { ...BASE, colour: { field: 'group', type: 'nominal' } },
      { ...BASE, x: { field: 'when', type: 'temporal', title: '' } },
      { ...BASE, rows: [] },
    ]
    for (const s of states) {
      const r = readSpec(buildSpec(s))
      if (!r.ok) throw new Error(`refused its own output for ${JSON.stringify(s)}`)
      expect(r.state).toEqual(s)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/chartSpec.test.ts
```
Expected: FAIL — `readSpec` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `frontend/src/lib/chartSpec.ts`:

```ts
export type ReadResult =
  | { ok: true; state: BuilderState }
  | { ok: false; reason: 'invalid-json' }
  | { ok: false; reason: 'unsupported'; unconsumed: string[] }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

/**
 * Dotted paths where `a` and `b` differ.
 *
 * Descends into objects only. An array that differs is reported at its own
 * path rather than per element, so a data mismatch reads as `data.values`
 * instead of thousands of `data.values.0.dose` entries.
 */
function diffPaths(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (deepEqual(a, b)) return out
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diffPaths(a[k], b[k], path ? `${path}.${k}` : k, out)
    }
    return out
  }
  out.push(path === '' ? '(root)' : path)
  return out
}

function readEncoding(raw: unknown): Encoding {
  const o = isPlainObject(raw) ? raw : {}
  return {
    field: typeof o.field === 'string' ? o.field : '',
    type: (o.type === 'quantitative' || o.type === 'temporal' || o.type === 'nominal'
      ? o.type
      : 'nominal') as FieldType,
    title: typeof o.title === 'string' ? o.title : '',
  }
}

/**
 * Reads spec text back into builder state, or refuses.
 *
 * Editability is decided by construction rather than by a checklist of
 * disqualifying features: derive a candidate, rebuild from it, and compare. A
 * checklist would drift out of step with buildSpec every time the UI gained a
 * control, and — more importantly — a hand-edit that the candidate failed to
 * capture is exactly what makes the rebuild differ, so this cannot silently
 * discard one.
 */
export function readSpec(json: string): ReadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: 'unsupported', unconsumed: ['(root)'] }
  }

  const enc = isPlainObject(parsed.encoding) ? parsed.encoding : {}
  const rawY = isPlainObject(enc.y) ? enc.y : {}
  const y = readEncoding(rawY)
  const aggregate = (AGGREGATES as readonly string[]).includes(String(rawY.aggregate))
    ? (rawY.aggregate as Aggregate)
    : 'none'

  const data = isPlainObject(parsed.data) ? parsed.data : {}
  const colour = isPlainObject(enc.color)
    ? { field: readEncoding(enc.color).field, type: readEncoding(enc.color).type }
    : null

  const candidate: BuilderState = {
    mark: (MARKS as readonly string[]).includes(String(parsed.mark))
      ? (parsed.mark as Mark)
      : 'line',
    rows: Array.isArray(data.values)
      ? (data.values as Record<string, string | number>[])
      : [],
    x: readEncoding(enc.x),
    y: { ...y, aggregate },
    colour,
  }

  const rebuilt: unknown = JSON.parse(buildSpec(candidate))
  if (deepEqual(rebuilt, parsed)) return { ok: true, state: candidate }

  return {
    ok: false,
    reason: 'unsupported',
    unconsumed: [...new Set(diffPaths(parsed, rebuilt))].sort(),
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/chartSpec.test.ts && npm run check
```
Expected: 21 passing in that file (11 from Task 2 plus 10), `0 ERRORS`.

- [ ] **Step 5: Prove the round-trip test is a real guard**

Temporarily break the symmetry — in `buildSpec`, change `if (state.x.title !== '') x.title = state.x.title` to always assign `x.title`. Re-run:

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/chartSpec.test.ts
```
Expected: the round-trip test FAILS. Restore with `git checkout -- src/lib/chartSpec.ts`, confirm `git status` is clean, and re-run to confirm green. Report what you saw.

- [ ] **Step 6: Commit**

```bash
cd /Users/richarc/Development/hermes
git add frontend/src/lib/chartSpec.ts frontend/src/lib/chartSpec.test.ts
git commit -m "$(cat <<'EOF'
feat: read a Vega-Lite spec back into builder state, or refuse

Editability is decided by construction: derive a candidate state,
rebuild from it, and compare against the original. Anything buildSpec
can express is accepted automatically, and a discarded hand-edit is
precisely what makes the rebuild differ — so silent loss is structurally
impossible rather than merely avoided.

Refusals carry the differing property paths, so the message can say
"uses transform" instead of "too complex", which tells a user nothing
about what to remove.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Find and replace the chart block under the cursor

**Files:**
- Modify: `frontend/src/Editor.svelte`
- Test: `frontend/src/Editor.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ChartBlock { from: number; to: number; spec: string }`, `enclosingChartBlock(): ChartBlock | null`, `replaceRange(from: number, to: number, text: string): void`. Task 8 calls both.

**Two findings from a spike against the real parser — do not re-derive these:**

1. The tree shape is `FencedCode` → `CodeMark`, `CodeInfo` (`"vega-lite"`), `CodeText` (the body), `CodeMark`. An empty block has no `CodeText` child at all, so the body must default to `''`.
2. `resolveInner(pos, side)` misses boundaries depending on `side`. Measured at every interesting cursor position:

   | Cursor | `side=-1` | `side=0` | `side=1` |
   |---|---|---|---|
   | exact start of the fence line | miss | **miss** | hit |
   | inside the info string or body | hit | hit | hit |
   | exact end of the closing fence | hit | **miss** | miss |

   Both boundaries are ordinary places to leave a cursor, so the implementation **must try `side=1` then `side=-1`**. Using `0` alone silently fails at both ends.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/Editor.test.ts`. Extend the existing `EditorApi` interface with the two new methods, and import the type:

```ts
interface ChartBlock {
  from: number
  to: number
  spec: string
}
```

Add to `EditorApi`:

```ts
  enclosingChartBlock(): ChartBlock | null
  replaceRange(from: number, to: number, text: string): void
```

Then append:

```ts
describe('chart block lookup', () => {
  const DOC = [
    '# Results',
    '',
    '```vega-lite',
    '{"mark": "line"}',
    '```',
    '',
    'After.',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
  ].join('\n')

  /** Mounts with DOC loaded and the cursor at `pos`. */
  function atPosition(pos: number) {
    const { editor, cleanup } = mountEditor()
    editor.setContent(DOC)
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: pos } })
    return { editor, view, cleanup }
  }

  it('finds the block when the cursor is in the spec body', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('"mark"'))
    const block = editor.enclosingChartBlock()
    expect(block).not.toBeNull()
    expect(block!.spec).toBe('{"mark": "line"}')
    cleanup()
  })

  it('finds the block from the very start of the opening fence', () => {
    // side=0 misses this position entirely; the implementation tries side=1.
    const { editor, cleanup } = atPosition(DOC.indexOf('```vega-lite'))
    expect(editor.enclosingChartBlock()).not.toBeNull()
    cleanup()
  })

  it('finds the block from the end of the closing fence', () => {
    // The mirror case: only side=-1 reaches this one.
    const end = DOC.indexOf('```\n\nAfter') + 3
    const { editor, cleanup } = atPosition(end)
    expect(editor.enclosingChartBlock()).not.toBeNull()
    cleanup()
  })

  it('returns null in ordinary prose', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('After.') + 2)
    expect(editor.enclosingChartBlock()).toBeNull()
    cleanup()
  })

  it('returns null inside a non-vega fenced block', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('const x'))
    expect(editor.enclosingChartBlock()).toBeNull()
    cleanup()
  })

  it('reports an empty body for an empty chart block', () => {
    const { editor, cleanup } = mountEditor()
    editor.setContent('```vega-lite\n```\n')
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 13 } })
    expect(editor.enclosingChartBlock()!.spec).toBe('')
    cleanup()
  })

  it('replaces a range and leaves the cursor after the new text', () => {
    const { editor, view, cleanup } = atPosition(0)
    const block = (() => {
      view.dispatch({ selection: { anchor: DOC.indexOf('"mark"') } })
      return editor.enclosingChartBlock()!
    })()
    editor.replaceRange(block.from, block.to, '```vega-lite\n{"mark": "bar"}\n```')
    expect(view.state.doc.toString()).toContain('"mark": "bar"')
    expect(view.state.doc.toString()).not.toContain('"mark": "line"')
    expect(view.state.selection.main.head).toBe(block.from + 32)
    cleanup()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/Editor.test.ts
```
Expected: FAIL — `editor.enclosingChartBlock is not a function`.

- [ ] **Step 3: Write the implementation**

In `frontend/src/Editor.svelte`, add to the imports from `@codemirror/language`:

```ts
  import { syntaxTree, forceParsing } from '@codemirror/language'
```

(Keep whatever that import already brings in; add only the missing names. `import type { SyntaxNode } from '@lezer/common'` is also needed.)

Add beside the other exported functions:

```ts
  export interface ChartBlock {
    from: number
    to: number
    spec: string
  }

  /**
   * The `vega-lite` fenced block containing the cursor, or null.
   *
   * Two things here are load-bearing and were established by measurement:
   *
   * 1. forceParsing first. CodeMirror parses only the first ~3000 characters
   *    synchronously, so a chart late in a long paper is invisible to the tree
   *    until parsing is forced — the same trap that made late fences fail to
   *    fold in v0.5.
   * 2. Both sides. resolveInner(pos, 0) misses BOTH the exact start of the
   *    opening fence and the exact end of the closing fence, and each is an
   *    ordinary place to leave a cursor. side=1 reaches the first, side=-1 the
   *    second, so try them in that order.
   */
  export function enclosingChartBlock(): ChartBlock | null {
    forceParsing(view, view.state.doc.length, 5000)
    const tree = syntaxTree(view.state)
    const pos = view.state.selection.main.head

    for (const side of [1, -1] as const) {
      let node: SyntaxNode | null = tree.resolveInner(pos, side)
      while (node && node.name !== 'FencedCode') node = node.parent
      if (!node) continue

      let info = ''
      let bodyFrom = -1
      let bodyTo = -1
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'CodeInfo') info = view.state.doc.sliceString(c.from, c.to)
        // An empty block has no CodeText child at all, hence the -1 default.
        if (c.name === 'CodeText') {
          bodyFrom = c.from
          bodyTo = c.to
        }
      }
      if (info.trim() !== 'vega-lite') continue

      return {
        from: node.from,
        to: node.to,
        spec: bodyFrom >= 0 ? view.state.doc.sliceString(bodyFrom, bodyTo) : '',
      }
    }
    return null
  }

  /** Replaces a document range, leaving the cursor after the inserted text. */
  export function replaceRange(from: number, to: number, text: string): void {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    })
    view.focus()
  }
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/Editor.test.ts && npm run check
```
Expected: 7 new tests passing, `0 ERRORS`.

- [ ] **Step 5: Prove the both-sides logic is load-bearing**

Temporarily change `for (const side of [1, -1] as const)` to `for (const side of [0] as const)` and re-run. Expected: the two boundary tests FAIL and the others pass. Restore with `git checkout -- src/Editor.svelte`, confirm `git status` is clean, re-run green, and report what you saw.

- [ ] **Step 6: Commit**

```bash
cd /Users/richarc/Development/hermes
git add frontend/src/Editor.svelte frontend/src/Editor.test.ts
git commit -m "$(cat <<'EOF'
feat: locate and replace the vega-lite block under the cursor

Two measured details drive this. forceParsing runs first, because
CodeMirror parses only the first ~3000 characters synchronously and a
chart late in a long paper would otherwise be invisible — the same trap
that made late fences fail to fold in v0.5.

And resolveInner is tried at both sides: side=0 misses the exact start of
the opening fence AND the exact end of the closing fence, both of which
are ordinary places to leave a cursor.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Import a data file through Go

**Files:**
- Modify: `documentservice.go`
- Test: `documentservice_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `ImportData() (string, error)` on `DocumentService`, callable from TS as `DocumentService.ImportData()` after bindings regenerate. Task 6 calls it.

- [ ] **Step 1: Write the failing test**

Append to `documentservice_test.go`:

```go
func TestReadDataFile(t *testing.T) {
	dir := t.TempDir()

	good := filepath.Join(dir, "data.csv")
	if err := os.WriteFile(good, []byte("a,b\n1,2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := readDataFile(good)
	if err != nil {
		t.Fatalf("readDataFile: %v", err)
	}
	if got != "a,b\n1,2\n" {
		t.Errorf("got %q", got)
	}

	if _, err := readDataFile(filepath.Join(dir, "missing.csv")); err == nil {
		t.Error("expected an error for a missing file")
	}

	big := filepath.Join(dir, "big.csv")
	if err := os.WriteFile(big, make([]byte, maxDataFileBytes+1), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readDataFile(big); err == nil {
		t.Error("expected an error for a file over the size limit")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/richarc/Development/hermes && go test ./. -run TestReadDataFile
```
Expected: FAIL — `undefined: readDataFile`.

- [ ] **Step 3: Write the implementation**

Add to `documentservice.go`. Ensure `fmt` and `os` are imported (both already are, for other functions):

```go
// A pasted or imported table is inlined into the document, so an enormous file
// would produce an unusable paper rather than a chart. Refuse early and say so.
const maxDataFileBytes = 10 << 20 // 10 MB

// ImportData opens a native picker for a delimited data file and returns its
// contents. The reading half is split into readDataFile so it stays testable,
// the same way ReadBibliography is testable while Open is not.
func (s *DocumentService) ImportData() (string, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle("Import Data").
		AddFilter("Data files", "*.csv;*.tsv;*.txt").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err
	}
	return readDataFile(path)
}

func readDataFile(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.Size() > maxDataFileBytes {
		return "", fmt.Errorf("that file is %d MB; the limit is %d MB because the data is stored in the document",
			info.Size()>>20, maxDataFileBytes>>20)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
```

- [ ] **Step 4: Run the Go checks and regenerate bindings**

```bash
cd /Users/richarc/Development/hermes && gofmt -l . | grep -v '^build/' ; cd /Users/richarc/Development/hermes && go vet ./. && go test ./. && go build -o /dev/null .
cd /Users/richarc/Development/hermes && wails3 task common:generate:bindings
```
Expected: gofmt prints nothing, Go tests pass, and `frontend/bindings/hermes/` gains `ImportData`. **Never hand-edit the bindings.**

- [ ] **Step 5: Confirm the frontend still builds against the new bindings**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check
```
Expected: unchanged test count, `0 ERRORS`.

- [ ] **Step 6: Commit**

```bash
cd /Users/richarc/Development/hermes
git add documentservice.go documentservice_test.go frontend/bindings
git commit -m "$(cat <<'EOF'
feat: import a delimited data file through a native picker

Split into ImportData (dialog) and readDataFile (readable, testable),
mirroring how ReadBibliography is testable while Open is not.

Capped at 10 MB: the data is inlined into the document, so an enormous
file would produce an unusable paper rather than a chart.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The modal shell and its data step

**Files:**
- Create: `frontend/src/ChartBuilder.svelte`, `frontend/src/ChartBuilder.test.ts`

**Interfaces:**
- Consumes: `parseDelimited`, `DataTable` from `./lib/dataTable`; `DocumentService.ImportData` from the bindings.
- Produces: the `ChartBuilder` component with props `{ initial: BuilderState | null, oncommit: (spec: string) => void, oncancel: () => void }`. Task 7 fills in the encoding half; Task 8 mounts it.

This task builds the modal, the paste box, the file-import button, parse feedback, and the row warning. The encoding controls and live preview arrive in Task 7 — so the commit button exists but stays disabled.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/ChartBuilder.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import ChartBuilder from './ChartBuilder.svelte'

// Mock the same module path App.svelte imports from: '../bindings/hermes',
// which exports a DocumentService object rather than loose functions.
const { DocumentService } = vi.hoisted(() => ({
  DocumentService: { ImportData: vi.fn() },
}))
vi.mock('../bindings/hermes', () => ({ DocumentService }))
const ImportData = DocumentService.ImportData

function mountBuilder() {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(ChartBuilder, {
    target,
    props: { initial: null, oncommit: vi.fn(), oncancel: vi.fn() },
  })
  flushSync()
  return {
    target,
    cleanup: () => {
      unmount(cmp)
      target.remove()
    },
  }
}

/** Types into the paste box the way a user would. */
function paste(target: HTMLElement, text: string) {
  const box = target.querySelector<HTMLTextAreaElement>('textarea')!
  box.value = text
  box.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

beforeEach(() => ImportData.mockReset())

describe('ChartBuilder data step', () => {
  it('reports the shape of a pasted table', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1.5\n5,3.2\n')
    expect(target.textContent).toContain('2 columns')
    expect(target.textContent).toContain('2 rows')
    cleanup()
  })

  it('shows a parse error inline rather than silently doing nothing', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'a,b,c\n1,2,3\n4,5\n')
    expect(target.textContent).toContain('Row 3')
    cleanup()
  })

  it('clears a previous error once the paste is fixed', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'a,b,c\n4,5\n')
    expect(target.textContent).toContain('Row 2')
    paste(target, 'a,b\n1,2\n')
    expect(target.textContent).not.toContain('Row 2')
    cleanup()
  })

  it('loads data through the Go importer when asked', async () => {
    ImportData.mockResolvedValueOnce('x,y\n1,2\n3,4\n')
    const { target, cleanup } = mountBuilder()
    const button = [...target.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Choose file'),
    )!
    button.click()
    await vi.waitFor(() => expect(target.textContent).toContain('2 rows'))
    cleanup()
  })

  it('reports an import failure without closing the modal', async () => {
    ImportData.mockRejectedValueOnce(new Error('nope'))
    const { target, cleanup } = mountBuilder()
    const button = [...target.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Choose file'),
    )!
    button.click()
    await vi.waitFor(() => expect(target.textContent).toContain("Couldn't read"))
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    cleanup()
  })

  it('warns above the inline-data threshold but still accepts the table', () => {
    const rows = Array.from({ length: 5001 }, (_, i) => `${i},${i}`).join('\n')
    const { target, cleanup } = mountBuilder()
    paste(target, `a,b\n${rows}\n`)
    expect(target.textContent).toContain('5001 rows')
    expect(target.textContent?.toLowerCase()).toContain('large')
    cleanup()
  })

  it('calls oncancel when Cancel is pressed', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const oncancel = vi.fn()
    const cmp = mount(ChartBuilder, {
      target,
      props: { initial: null, oncommit: vi.fn(), oncancel },
    })
    flushSync()
    const button = [...target.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancel',
    )!
    button.click()
    flushSync()
    expect(oncancel).toHaveBeenCalled()
    unmount(cmp)
    target.remove()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/ChartBuilder.test.ts
```
Expected: FAIL — cannot resolve `./ChartBuilder.svelte`.

- [ ] **Step 3: Write the component**

Create `frontend/src/ChartBuilder.svelte`:

```svelte
<script lang="ts">
  import { parseDelimited, type DataTable } from './lib/dataTable'
  import type { BuilderState } from './lib/chartSpec'
  import { DocumentService } from '../bindings/hermes'

  interface Props {
    initial: BuilderState | null
    oncommit: (spec: string) => void
    oncancel: () => void
  }

  const { initial, oncommit, oncancel }: Props = $props()

  // Above this many rows the document gets unwieldy, but aggregation makes a
  // large raw table a legitimate input — so this warns and does not block.
  const ROW_WARNING = 5000

  let pasted = $state('')
  let table: DataTable | null = $state(null)
  let parseError = $state('')
  let importError = $state('')

  // Reopening an existing chart arrives with rows already parsed, so the paste
  // box starts empty and the table is seeded from the spec.
  if (initial) {
    const names = Object.keys(initial.rows[0] ?? {})
    table = {
      columns: names.map((name) => ({
        name,
        type: typeof initial.rows[0]?.[name] === 'number' ? 'quantitative' : 'nominal',
      })),
      rows: initial.rows,
    }
  }

  function load(text: string) {
    importError = ''
    if (text.trim() === '') {
      table = null
      parseError = ''
      return
    }
    const result = parseDelimited(text)
    if (result.ok) {
      table = result.table
      parseError = ''
    } else {
      table = null
      parseError = result.message
    }
  }

  function onPaste(event: Event) {
    pasted = (event.currentTarget as HTMLTextAreaElement).value
    load(pasted)
  }

  async function chooseFile() {
    try {
      const text = await DocumentService.ImportData()
      if (text) {
        pasted = text
        load(text)
      }
    } catch {
      importError = "Couldn't read that file."
    }
  }
</script>

<div class="modal-backdrop">
  <div class="chart-builder modal" role="dialog" aria-label="Chart builder">
    <h2>Chart</h2>

    <section class="data-step">
      <label for="chart-paste">Paste a table</label>
      <textarea id="chart-paste" rows="6" value={pasted} oninput={onPaste}></textarea>
      <button onclick={() => void chooseFile()}>Choose file…</button>

      {#if parseError}
        <p class="field-error" role="alert">{parseError}</p>
      {/if}
      {#if importError}
        <p class="field-error" role="alert">{importError}</p>
      {/if}
      {#if table}
        <p class="data-summary">
          {table.columns.length} columns, {table.rows.length} rows
          {#if table.rows.length > ROW_WARNING}
            — that is a large table to store in the document, but it will work.
          {/if}
        </p>
      {/if}
    </section>

    <div class="modal-buttons">
      <button onclick={oncancel}>Cancel</button>
      <button disabled>Insert chart</button>
    </div>
  </div>
</div>
```

Add to `frontend/public/style.css`, using existing palette variables only — `styleContract.test.ts` fails the build on a literal colour:

```css
.chart-builder {
  width: min(56rem, 90vw);
  text-align: left;
}

.chart-builder textarea {
  width: 100%;
  font-family: monospace;
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
}

.chart-builder .field-error {
  color: var(--cite-error-fg);
}

.chart-builder .data-summary {
  color: var(--muted);
}
```

**Every variable above was checked against the real palette — use these names exactly.** `styleContract.test.ts` fails the build on any literal colour and on the two palette blocks diverging, so do not invent a name: there is no `--error-fg`, no `--muted-fg`, and no `--font-mono`. `--cite-error-fg` is reused deliberately rather than adding a new pair to both blocks; it is already the palette's "something in this document is wrong" foreground. `font-family: monospace` is a literal, which is fine — the contract test forbids literal *colours* only.

- [ ] **Step 4: Run the tests**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/ChartBuilder.test.ts && npm run check
```
Expected: 7 passing, `0 ERRORS`.

- [ ] **Step 5: Run the whole suite**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run build
```
Expected: about 251 tests across 20 files; the build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/richarc/Development/hermes
git add frontend/src/ChartBuilder.svelte frontend/src/ChartBuilder.test.ts frontend/public/style.css
git commit -m "$(cat <<'EOF'
feat: add the chart builder modal and its data step

Paste or import a table; parse failures report inline, where the user is
looking, rather than as a toast behind the dialog.

Large tables warn but are accepted: aggregation makes a big raw table a
legitimate input, so this is verbosity rather than user error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Encoding controls, live preview, and commit

**Files:**
- Modify: `frontend/src/ChartBuilder.svelte`, `frontend/src/ChartBuilder.test.ts`

**Interfaces:**
- Consumes: `buildSpec`, `MARKS`, `AGGREGATES`, `BuilderState` from `./lib/chartSpec`; `embedChart` from `./lib/charts`.
- Produces: a working `oncommit(spec)` carrying the generated spec text.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/ChartBuilder.test.ts`:

```ts
function select(target: HTMLElement, label: string, value: string) {
  const el = target.querySelector<HTMLSelectElement>(`select[data-field="${label}"]`)!
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
}

describe('ChartBuilder encoding step', () => {
  it('offers every column as an x and y choice once data is loaded', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n5,2\n')
    const x = target.querySelector<HTMLSelectElement>('select[data-field="x"]')!
    expect([...x.options].map((o) => o.value)).toEqual(['dose', 'response'])
    cleanup()
  })

  it('keeps Insert disabled until both axes are chosen', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n5,2\n')
    const insert = [...target.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Insert chart',
    )!
    expect(insert.disabled).toBe(true)
    select(target, 'x', 'dose')
    select(target, 'y', 'response')
    expect(insert.disabled).toBe(false)
    cleanup()
  })

  it('hands the generated spec to oncommit', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const oncommit = vi.fn()
    const cmp = mount(ChartBuilder, {
      target,
      props: { initial: null, oncommit, oncancel: vi.fn() },
    })
    flushSync()
    paste(target, 'dose,response\n0,1\n5,2\n')
    select(target, 'x', 'dose')
    select(target, 'y', 'response')
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert chart')!
      .click()
    flushSync()

    expect(oncommit).toHaveBeenCalledTimes(1)
    const spec = JSON.parse(oncommit.mock.calls[0][0] as string)
    expect(spec.mark).toBe('line')
    expect(spec.encoding.x.field).toBe('dose')
    expect(spec.encoding.y.field).toBe('response')
    expect(spec.data.values).toHaveLength(2)
    unmount(cmp)
    target.remove()
  })

  it('prefills from an existing chart and labels the action as an update', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(ChartBuilder, {
      target,
      props: {
        initial: {
          mark: 'bar',
          rows: [{ dose: 0, response: 1 }],
          x: { field: 'dose', type: 'quantitative', title: '' },
          y: { field: 'response', type: 'quantitative', title: '', aggregate: 'none' },
          colour: null,
        },
        oncommit: vi.fn(),
        oncancel: vi.fn(),
      },
    })
    flushSync()
    expect(target.querySelector<HTMLSelectElement>('select[data-field="x"]')!.value).toBe('dose')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="mark"]')!.value).toBe('bar')
    expect(target.textContent).toContain('Update chart')
    unmount(cmp)
    target.remove()
  })

  it('hides the aggregate control for boxplot, which summarises for itself', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'dose,response\n0,1\n5,2\n')
    select(target, 'mark', 'boxplot')
    expect(target.querySelector('select[data-field="aggregate"]')).toBeNull()
    cleanup()
  })

  it('seeds the field type from inference when a column is picked', () => {
    const { target, cleanup } = mountBuilder()
    paste(target, 'label,score\na,1\nb,2\n')
    select(target, 'x', 'label')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="x-type"]')!.value).toBe(
      'nominal',
    )
    select(target, 'x', 'score')
    expect(target.querySelector<HTMLSelectElement>('select[data-field="x-type"]')!.value).toBe(
      'quantitative',
    )
    cleanup()
  })

  it('lets the user override an inferred type, and uses the override', () => {
    // An integer ID column infers as quantitative but is really nominal; only
    // the author knows that, so the override has to reach the spec.
    const target = document.createElement('div')
    document.body.appendChild(target)
    const oncommit = vi.fn()
    const cmp = mount(ChartBuilder, {
      target,
      props: { initial: null, oncommit, oncancel: vi.fn() },
    })
    flushSync()
    paste(target, 'id,score\n1,10\n2,20\n')
    select(target, 'x', 'id')
    select(target, 'y', 'score')
    select(target, 'x-type', 'nominal')
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert chart')!
      .click()
    flushSync()

    const spec = JSON.parse(oncommit.mock.calls[0][0] as string)
    expect(spec.encoding.x.type).toBe('nominal')
    unmount(cmp)
    target.remove()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/ChartBuilder.test.ts
```
Expected: FAIL — no `select[data-field="x"]` exists.

- [ ] **Step 3: Extend the component**

In `frontend/src/ChartBuilder.svelte`, add to the script:

```ts
  import { buildSpec, MARKS, AGGREGATES, type Mark, type Aggregate } from './lib/chartSpec'
  import { embedChart, type ChartView } from './lib/charts'
  import type { FieldType } from './lib/dataTable'

  const FIELD_TYPES: readonly FieldType[] = ['quantitative', 'temporal', 'nominal']

  let mark: Mark = $state(initial?.mark ?? 'line')
  let xField = $state(initial?.x.field ?? '')
  let yField = $state(initial?.y.field ?? '')
  let colourField = $state(initial?.colour?.field ?? '')
  let xTitle = $state(initial?.x.title ?? '')
  let yTitle = $state(initial?.y.title ?? '')
  let aggregate: Aggregate = $state(initial?.y.aggregate ?? 'none')

  // Types are seeded from inference when a column is picked, then owned by the
  // user: an ID column of integers infers as quantitative but is really
  // nominal, and nothing but the author can know that.
  let xType: FieldType = $state(initial?.x.type ?? 'nominal')
  let yType: FieldType = $state(initial?.y.type ?? 'quantitative')
  let colourType: FieldType = $state(initial?.colour?.type ?? 'nominal')

  const columns = $derived(table?.columns ?? [])
  const typeOf = (name: string): FieldType =>
    columns.find((c) => c.name === name)?.type ?? 'nominal'

  function pickX(name: string) {
    xField = name
    xType = typeOf(name)
  }
  function pickY(name: string) {
    yField = name
    yType = typeOf(name)
  }
  function pickColour(name: string) {
    colourField = name
    if (name) colourType = typeOf(name)
  }

  const ready = $derived(table !== null && xField !== '' && (yField !== '' || aggregate === 'count'))

  const state = $derived<BuilderState | null>(
    ready && table
      ? {
          mark,
          rows: table.rows,
          x: { field: xField, type: xType, title: xTitle },
          y: {
            field: yField,
            type: yType,
            title: yTitle,
            aggregate: mark === 'boxplot' ? 'none' : aggregate,
          },
          colour: colourField ? { field: colourField, type: colourType } : null,
        }
      : null,
  )

  let previewEl: HTMLDivElement | undefined = $state()
  let view: ChartView | null = null
  let generation = 0

  // Mirrors charts.ts: a newer pass invalidates an older one, so a slow embed
  // cannot overwrite a faster later one.
  $effect(() => {
    const s = state
    const el = previewEl
    if (!s || !el) return
    const gen = ++generation
    void embedChart(el, buildSpec(s)).then((v) => {
      if (gen !== generation) {
        v?.finalize()
        return
      }
      view?.finalize()
      view = v
    })
  })

  $effect(() => () => view?.finalize())

  function commit() {
    if (state) oncommit(buildSpec(state))
  }
```

Replace the `modal-buttons` block and add the controls between the data step and the buttons:

```svelte
    {#if table}
      <section class="encode-step">
        <label>Mark
          <select data-field="mark" bind:value={mark}>
            {#each MARKS as m (m)}<option value={m}>{m}</option>{/each}
          </select>
        </label>

        <label>X
          <select data-field="x" value={xField} onchange={(e) => pickX(e.currentTarget.value)}>
            {#each columns as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
          </select>
        </label>
        <label>X type
          <select data-field="x-type" bind:value={xType}>
            {#each FIELD_TYPES as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        </label>
        <label>X title <input data-field="x-title" bind:value={xTitle} /></label>

        <label>Y
          <select data-field="y" value={yField} onchange={(e) => pickY(e.currentTarget.value)}>
            {#each columns as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
          </select>
        </label>
        <label>Y type
          <select data-field="y-type" bind:value={yType}>
            {#each FIELD_TYPES as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        </label>
        <label>Y title <input data-field="y-title" bind:value={yTitle} /></label>

        {#if mark !== 'boxplot'}
          <label>Aggregate
            <select data-field="aggregate" bind:value={aggregate}>
              {#each AGGREGATES as a (a)}<option value={a}>{a}</option>{/each}
            </select>
          </label>
        {/if}

        <label>Colour
          <select
            data-field="colour"
            value={colourField}
            onchange={(e) => pickColour(e.currentTarget.value)}
          >
            <option value="">none</option>
            {#each columns as c (c.name)}<option value={c.name}>{c.name}</option>{/each}
          </select>
        </label>
      </section>

      <div class="chart-preview" bind:this={previewEl}></div>
    {/if}

    <div class="modal-buttons">
      <button onclick={oncancel}>Cancel</button>
      <button disabled={!ready} onclick={commit}>
        {initial ? 'Update chart' : 'Insert chart'}
      </button>
    </div>
```

**The `<select>` elements need an explicit initial value.** With `bind:value` and no matching option selected, Svelte leaves the binding at `''`; the tests set values explicitly, so no default selection is required — but do not "helpfully" auto-select the first column, because the disabled-until-chosen test asserts Insert starts disabled.

- [ ] **Step 4: Run the tests**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/ChartBuilder.test.ts && npm run check
```
Expected: 14 passing in that file (7 from Task 6 plus 7), `0 ERRORS`.

Note the live preview cannot be asserted — vega-embed needs real layout, and every jsdom rect is 0. `embedChart` resolving to `null` under jsdom is expected and must not fail a test.

- [ ] **Step 5: Commit**

```bash
cd /Users/richarc/Development/hermes
git add frontend/src/ChartBuilder.svelte frontend/src/ChartBuilder.test.ts
git commit -m "$(cat <<'EOF'
feat: add encoding controls, live preview, and commit to the builder

The preview reuses the vega-embed that charts.ts already lazy-loads, and
guards overlapping passes the same way, so a slow embed cannot overwrite
a faster later one.

Aggregate is hidden for boxplot, which computes its own summary and
would conflict.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire it to the Insert menu

**Files:**
- Modify: `frontend/src/App.svelte`, `frontend/src/App.test.ts`, `menu.go`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the finished feature.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/App.test.ts`. The `vi.hoisted` harness at the top already captures listeners in `listeners` and mocks `DocumentService`:

```ts
describe('chart builder', () => {
  const WITH_CHART = [
    '# Results',
    '',
    '```vega-lite',
    '{"data": {"values": [{"a": 1}]}, "mark": "line", "encoding": {"x": {"field": "a", "type": "quantitative"}, "y": {"field": "a", "type": "quantitative"}}}',
    '```',
    '',
  ].join('\n')

  const WITH_TRANSFORM = [
    '# Results',
    '',
    '```vega-lite',
    '{"data": {"values": []}, "transform": [{"filter": "true"}], "mark": "line"}',
    '```',
    '',
  ].join('\n')

  async function openDoc(content: string) {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/paper.md', content })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Results'))
    return target
  }

  it('opens an empty builder from prose', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    expect(target.textContent).toContain('Insert chart')
  })

  it('prefills the builder when the cursor is inside a chart block', async () => {
    const target = await openDoc(WITH_CHART)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: WITH_CHART.indexOf('"mark"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Update chart')
  })

  it('refuses a spec it cannot model and leaves the document untouched', async () => {
    const target = await openDoc(WITH_TRANSFORM)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const before = view.state.doc.toString()
    view.dispatch({ selection: { anchor: WITH_TRANSFORM.indexOf('"filter"') } })
    listeners['menu:insert-chart']({ data: null })
    flushSync()

    expect(target.querySelector('.chart-builder')).toBeNull()
    expect(target.textContent).toContain('transform')
    expect(view.state.doc.toString()).toBe(before)
  })

  it('inserts a fenced block at the cursor on commit', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-chart']({ data: null })
    flushSync()

    const box = target.querySelector<HTMLTextAreaElement>('#chart-paste')!
    box.value = 'dose,response\n0,1\n5,2\n'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    for (const [field, value] of [
      ['x', 'dose'],
      ['y', 'response'],
    ]) {
      const el = target.querySelector<HTMLSelectElement>(`select[data-field="${field}"]`)!
      el.value = value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      flushSync()
    }
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Insert chart')!
      .click()
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const doc = view.state.doc.toString()
    expect(doc).toContain('```vega-lite')
    expect(doc).toContain('"field": "dose"')
    expect(target.querySelector('.chart-builder')).toBeNull()
  })

  it('does nothing from the welcome screen', async () => {
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).toBeNull()
  })
})
```

Two harness changes are needed at the top of `App.test.ts`:

1. Import `EditorView` (`import { EditorView } from '@codemirror/view'`) if it is not already imported.
2. Add `ImportData: vi.fn(async () => '')` to the mocked `DocumentService` object inside `vi.hoisted`. `ChartBuilder` imports `DocumentService` from the same mocked module, and a missing method would throw the moment the Choose file… button is rendered and clicked.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run src/App.test.ts
```
Expected: FAIL — `listeners['menu:insert-chart']` is undefined.

- [ ] **Step 3: Wire up App.svelte**

Add imports:

```ts
  import ChartBuilder from './ChartBuilder.svelte'
  import { readSpec, type BuilderState } from './lib/chartSpec'
  import { foldAllCodeBlocks } from './lib/foldCommands'
```

Add state and handlers beside `applyFormat`:

```ts
  let chartOpen = $state(false)
  let chartInitial: BuilderState | null = $state(null)
  let chartTarget: { from: number; to: number } | null = null

  function openChartBuilder() {
    // Same guard as applyFormat: menu items fire regardless of focus, so
    // without it this would act on the hidden document behind the welcome pane.
    if (showWelcome) return

    const block = editor.enclosingChartBlock()
    if (!block) {
      chartInitial = null
      chartTarget = null
      chartOpen = true
      return
    }

    const result = readSpec(block.spec)
    if (!result.ok) {
      toast(
        result.reason === 'invalid-json'
          ? "That chart block isn't valid JSON, so it can't be opened here."
          : `That chart uses ${result.unconsumed.slice(0, 2).join(' and ')}, which the builder can't edit.`,
      )
      return
    }
    chartInitial = result.state
    chartTarget = { from: block.from, to: block.to }
    chartOpen = true
  }

  function commitChart(spec: string) {
    const block = '```vega-lite\n' + spec + '\n```'
    if (chartTarget) {
      editor.replaceRange(chartTarget.from, chartTarget.to, block)
    } else {
      editor.insertAtCursor(block + '\n')
    }
    chartOpen = false
    chartInitial = null
    chartTarget = null
    // Inline data runs to dozens of lines; fold it so the prose stays readable.
    editor.runCommand(foldAllCodeBlocks)
  }
```

In `onMount`, alongside the other menu subscriptions:

```ts
    Events.On('menu:insert-chart', () => openChartBuilder())
```

In the markup, beside the other overlays:

```svelte
  {#if chartOpen}
    <ChartBuilder
      initial={chartInitial}
      oncommit={commitChart}
      oncancel={() => {
        chartOpen = false
        chartInitial = null
        chartTarget = null
      }}
    />
  {/if}
```

- [ ] **Step 4: Add the Insert menu**

In `menu.go`, **remove** the existing `Insert Citation…` item from the File submenu (currently between Open Recent and Save) and add a new submenu after the File block, before `format := menu.AddSubmenu("Format")`:

```go
	insert := menu.AddSubmenu("Insert")
	insert.Add("Citation…").SetAccelerator("shift+cmdorctrl+c").OnClick(func(*application.Context) {
		app.Event.Emit("menu:insert-citation", nil)
	})
	// No accelerator: an invented chord cannot be checked against every macOS
	// binding, and the menu item is the discoverable route — the same reasoning
	// as Blockquote in the Format menu.
	insert.Add("Chart…").OnClick(func(*application.Context) {
		app.Event.Emit("menu:insert-chart", nil)
	})
```

Keep the accelerator exactly `shift+cmdorctrl+c` so ⌘⇧C continues to work; it moves menus but not chords.

- [ ] **Step 5: Add the toolbar button**

In `App.svelte`'s toolbar, after the Cite button:

```svelte
    <button onclick={openChartBuilder}>Chart</button>
```

- [ ] **Step 6: Update CLAUDE.md**

Section 4 lists every event `menu.go` emits. Add `menu:insert-chart` to that list. In the same section, `menu:insert-citation` is described as coming from the File menu — correct it to Insert.

- [ ] **Step 7: Run everything**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check && npm run build
cd /Users/richarc/Development/hermes && gofmt -l . | grep -v '^build/' ; cd /Users/richarc/Development/hermes && go vet ./. && go test ./. && go build -o /dev/null .
```
Expected: about 262 tests across 20 files, `0 ERRORS`, both builds succeed, gofmt silent, Go tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/richarc/Development/hermes
git add frontend/src/App.svelte frontend/src/App.test.ts menu.go CLAUDE.md
git commit -m "$(cat <<'EOF'
feat: open the chart builder from a new Insert menu

Insert Citation… moves out of File into Insert, which is where macOS
apps put content insertion; ⌘⇧C is unchanged, since the accelerator
belongs to the item rather than the menu.

The cursor decides the mode: inside a vega-lite block the builder opens
prefilled and replaces that block, anywhere else it inserts a new one.
A spec the builder cannot model is refused by name, and the document is
left exactly as it was.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Record it

**Files:**
- Modify: `CHANGELOG.md`, `ROADMAP.md`

- [ ] **Step 1: Add the changelog entry**

`## [Unreleased]` already exists, carrying the block-folding entry. Add to its `### Added` section:

```markdown
- A chart builder, from Insert → Chart… or the toolbar. Paste a table or
  import a CSV, choose a mark and which columns map to which axis, and watch
  the chart update as you go; inserting writes a `vega-lite` block at the
  cursor with the data inlined, so the document stays self-contained. Put the
  cursor back inside that block and Insert → Chart… reopens it with the
  controls filled in. A chart using anything the builder cannot express —
  layers, transforms, a hand-set `title: null` — is left strictly alone, and
  says which feature stopped it rather than failing vaguely.
- Insert Citation… moved from the File menu to a new Insert menu, alongside
  Insert Chart…. ⌘⇧C is unchanged.
```

- [ ] **Step 2: Tick the roadmap item**

In `ROADMAP.md`, under `## v0.6.0 — Vega-Lite`, change the unchecked box to `- [x]`.

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check
cd /Users/richarc/Development/hermes && go test ./.
git add CHANGELOG.md ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: record the chart builder in the changelog and roadmap

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification summary

Counts are estimates. Report actuals; never edit a test to match a number here.

| After task | Frontend tests | Files | Go |
|---|---|---|---|
| Baseline | 211 | 17 | passing |
| 1 | ~224 | 18 | — |
| 2 | ~235 | 19 | — |
| 3 | ~245 | 19 | — |
| 4 | ~252 | 19 | — |
| 5 | ~252 | 19 | +1 test |
| 6 | ~259 | 20 | — |
| 7 | ~266 | 20 | — |
| 8 | ~272 | 20 | — |
| 9 | ~272 | 20 | — |

## Known limitation, by design

`docs/sample-paper.md`'s own chart will **not** reopen in the builder: it carries
a `description` field and `"title": null`, neither of which the UI models. That
is the refusal working correctly rather than a bug — `title: null` suppresses an
axis title, which is genuinely different from having none, and silently dropping
it on save is exactly what the round-trip rule exists to prevent. Do not widen
the model to accommodate the sample; if it should be editable, change the sample.

## Manual check, once, at the end

jsdom has no layout, so no test here proves a chart actually draws.

```bash
cd /Users/richarc/Development/hermes && wails3 task run
```

1. Insert → Chart… with the cursor in prose. Paste `dose,response` with a few
   rows, pick line, x=dose, y=response. **The preview draws.** Insert — the
   block lands folded and the preview pane shows the chart.
2. Put the cursor back inside that block and reopen. The controls are prefilled
   and the button reads Update chart. Switch to bar and update; the block is
   replaced in place.
3. Add `"transform": [{"filter": "true"}]` to the block by hand and reopen. It
   refuses, naming transform, and the block is untouched.
4. Import a CSV through Choose file… instead of pasting.
5. Set Aggregate to mean on a table with repeated x values and confirm the chart
   summarises.
6. Confirm the modal is legible in both light and dark appearance.
7. Check ⌘⇧C still opens the Zotero picker from its new home in Insert.
