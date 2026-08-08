# Editing a Chart's Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefill the chart builder's data box when reopening a chart, so a chart's data can be edited instead of only replaced.

**Architecture:** One new pure function — `toDelimited`, the inverse of `parseDelimited` — in `frontend/src/lib/dataTable.ts`, and one changed initialiser in `ChartBuilder.svelte` that seeds the textarea from it. Every existing edit path (`load`, `onPaste`, `chooseFile`) is untouched: editing prefilled text goes through exactly the code a fresh paste goes through.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest 4, jsdom.

## Source design

`docs/superpowers/specs/2026-08-08-chart-data-editing-design.md` (commit `3c67f3d`). Read it before starting — particularly the two asymmetries it records, which are the whole subtlety of this change.

## Global Constraints

- Branch: `feat/figure-presentation`. Commit onto it.
- `toDelimited` output is **always comma-separated**, whatever the original paste used. The source text is not stored anywhere, so its delimiter cannot be.
- A field is quoted **only** when it contains a comma or a double quote. An inner quote is doubled. That is exactly what the existing private `splitLine` parses.
- **A newline inside a value is replaced with a single space, never quoted.** `parseDelimited` splits text into lines before `splitLine` sees a quote, so an embedded newline is outside the grammar however it is written; quoting one would produce a box that fails to parse with a row-length error the user did not cause.
- A table with no columns serializes to `''`.
- The round trip is exact **only for a table that came from `parseDelimited`**. A `tableFromRows` table can carry a declared type inference would not reach (an integer column declared `nominal`), and re-parsing re-infers it. This is correct: the type the chart uses lives in `xType`/`yType`/`colourType`, which `load()` never touches.
- Numbers serialize with `String(n)`. Values came from JSON, so this round-trips them exactly.
- Style idiom for `frontend/src/lib/*.ts` and `.svelte`: no semicolons, single quotes, 2-space indent, comments explaining *why*. Both files touched here are heavily commented and several comments record real bugs — preserve every comment whose code survives.
- Tests: `(cd frontend && npx vitest run src/lib/dataTable.test.ts)`, whole suite `(cd frontend && npx vitest run)`, type check `(cd frontend && npm run check)`.
- Do not add a confirmation before clearing the box, a "revert to the chart's data" control, or any size threshold. All three were considered and rejected in the design.

---

### Task 1: `toDelimited`, the inverse of `parseDelimited`

**Files:**
- Modify: `frontend/src/lib/dataTable.ts` (append after `tableFromRows`, which ends at line 159)
- Test: `frontend/src/lib/dataTable.test.ts` (append)

**Interfaces:**
- Consumes: `DataTable`, and the grammar the module's private `splitLine` already parses.
- Produces: `export function toDelimited(table: DataTable): string`. Task 2 calls it exactly once.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/dataTable.test.ts`:

```ts
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
```

Extend the file's existing import to `import { parseDelimited, tableFromRows, toDelimited } from './dataTable'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `(cd frontend && npx vitest run src/lib/dataTable.test.ts)`
Expected: FAIL — `toDelimited is not a function` (or a TypeScript error on the import).

- [ ] **Step 3: Write the implementation**

Append to `frontend/src/lib/dataTable.ts`:

```ts
/**
 * Renders a table as delimited text — the inverse of `parseDelimited`, for
 * putting an already-parsed table back in front of the user to edit.
 *
 * Always comma-separated, whatever the original paste used: the source text is
 * not stored anywhere, so its delimiter cannot be. Comma is `parseDelimited`'s
 * own default for a header it cannot sniff, so the output always re-parses.
 *
 * The round trip is exact for a table that came from `parseDelimited`, and
 * only for those. A table from `tableFromRows` can carry a declared type
 * inference would not reach — an integer column declared `nominal` — and
 * re-parsing re-infers it. That is not a defect to design around: the type the
 * chart uses lives in the builder's own encoding state, which never reads it
 * back off the table.
 */
export function toDelimited(table: DataTable): string {
  if (table.columns.length === 0) return ''
  const names = table.columns.map((c) => c.name)
  const lines = [names.map(field).join(',')]
  for (const row of table.rows) {
    lines.push(names.map((name) => field(String(row[name] ?? ''))).join(','))
  }
  return lines.join('\n')
}

/**
 * One field, quoted only if it would otherwise be misread.
 *
 * `splitLine` treats a comma as a separator and a double quote as opening a
 * quoted run wherever it appears, so those two are the whole list; an inner
 * quote is doubled, which is what `splitLine` unescapes.
 *
 * A newline is different in kind. `parseDelimited` splits the text into lines
 * before `splitLine` ever runs, so an embedded newline is outside the grammar
 * however it is written — quoting it would produce a box that fails to parse
 * with a row-length error the user did not cause. No table pasted into the box
 * can contain one; the only source is a hand-authored spec. So it is
 * normalised into the grammar instead, losing the line break and keeping the
 * table readable.
 */
function field(value: string): string {
  const flat = value.replace(/\r\n?|\n/g, ' ')
  if (!/[",]/.test(flat)) return flat
  return `"${flat.replace(/"/g, '""')}"`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run src/lib/dataTable.test.ts && npm run check)`
Expected: PASS, including every pre-existing `parseDelimited`, `inferType` and `tableFromRows` test. No type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/dataTable.ts frontend/src/lib/dataTable.test.ts
git commit -m "feat: render a parsed table back to delimited text"
```

---

### Task 2: Prefill the builder's data box

**Files:**
- Modify: `frontend/src/ChartBuilder.svelte` — the `pasted` initialiser (line 75), the label and textarea (lines 286-287)
- Test: `frontend/src/ChartBuilder.test.ts` (append)

**Interfaces:**
- Consumes: `toDelimited` from Task 1, and the existing `seed` object whose `table` field is already the reopened chart's rows (`seed.table`, set at line 60 from `tableFromRows`).
- Produces: no new exports. The textarea's `id` stays `chart-paste`, so the existing `label for=` association and any test selecting `textarea` are unaffected.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/ChartBuilder.test.ts`:

```ts
/** Mounts a builder reopened on an existing chart. */
function reopened(
  rows: Record<string, string | number>[],
  overrides: { xType?: 'quantitative' | 'temporal' | 'nominal' } = {},
  oncommit = vi.fn(),
) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(ChartBuilder, {
    target,
    props: {
      initial: {
        mark: 'bar' as const,
        rows,
        x: { field: 'dose', type: overrides.xType ?? ('quantitative' as const), title: '' },
        y: {
          field: 'response',
          type: 'quantitative' as const,
          title: '',
          aggregate: 'none' as const,
        },
        colour: null,
        extras: {},
      },
      oncommit,
      oncancel: vi.fn(),
    },
  })
  flushSync()
  return {
    target,
    oncommit,
    box: target.querySelector<HTMLTextAreaElement>('textarea')!,
    update: () => {
      ;[...target.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === 'Update chart')!
        .click()
      flushSync()
    },
    cleanup: () => {
      unmount(cmp)
      target.remove()
    },
  }
}

describe('ChartBuilder data box on reopen', () => {
  it('prefills the box with the chart’s own data', () => {
    // Without this the box opens empty and auto-focused, and the first
    // keystroke replaces the seeded table with a one-column, no-row table.
    const r = reopened([
      { dose: 0, response: 1.5 },
      { dose: 5, response: 3.25 },
    ])
    expect(r.box.value).toBe('dose,response\n0,1.5\n5,3.25')
    r.cleanup()
  })

  it('still opens empty for a new chart', () => {
    const { target, cleanup } = mountBuilder()
    expect(target.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('')
    cleanup()
  })

  it('commits a row added to the prefilled text', () => {
    const r = reopened([{ dose: 0, response: 1.5 }])
    paste(r.target, r.box.value + '\n5,3.25')
    r.update()
    const spec = JSON.parse(r.oncommit.mock.calls[0][0] as string)
    expect(spec.data.values).toEqual([
      { dose: 0, response: 1.5 },
      { dose: 5, response: 3.25 },
    ])
    r.cleanup()
  })

  it('commits a value edited in the prefilled text', () => {
    const r = reopened([{ dose: 0, response: 1.5 }])
    paste(r.target, 'dose,response\n0,99')
    r.update()
    const spec = JSON.parse(r.oncommit.mock.calls[0][0] as string)
    expect(spec.data.values).toEqual([{ dose: 0, response: 99 }])
    r.cleanup()
  })

  it('keeps a declared type override when the data text is edited', () => {
    // Re-parsing re-infers the TABLE's column type, but the chart's type is
    // separate state that load() never touches. A refactor that started
    // reading types off the table would break this silently.
    const r = reopened([{ dose: 1, response: 1 }], { xType: 'nominal' })
    paste(r.target, 'dose,response\n1,1\n2,2')
    r.update()
    const spec = JSON.parse(r.oncommit.mock.calls[0][0] as string)
    expect(spec.encoding.x.type).toBe('nominal')
    r.cleanup()
  })
})
```

Note the existing `paste()` helper at the top of the file already sets the textarea's value and dispatches `input`, which is exactly how a user editing the box behaves — reuse it rather than writing another.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `(cd frontend && npx vitest run src/ChartBuilder.test.ts)`
Expected: FAIL — the prefill test reports `expected '' to be 'dose,response\n0,1.5\n5,3.25'`. The three editing tests may pass already (they drive the box directly), and the type-override test should pass; that is fine and expected — only the prefill is new behaviour. Record in the report which failed and which did not.

- [ ] **Step 3: Write the implementation**

In `frontend/src/ChartBuilder.svelte`, extend the `dataTable` import on line 3 to include `toDelimited`:

```ts
  import { parseDelimited, tableFromRows, toDelimited, type DataTable, type FieldType } from './lib/dataTable'
```

Replace line 75:

```ts
  let pasted = $state('')
```

with:

```ts
  // Reopening a chart seeds the box with its own data, so it can be edited
  // rather than only replaced. Guarded because a table with no columns
  // serializes to '', which is also what an unseeded builder wants.
  let pasted = $state(seed.table ? toDelimited(seed.table) : '')
```

Then delete the now-stale sentence from the `seed` doc comment above it (lines 43-44), which currently reads:

```
  // Reopening an existing chart arrives with rows already parsed, so the
  // paste box starts empty and the table is seeded from the spec. The
```

Replace those two lines with:

```
  // Reopening an existing chart arrives with rows already parsed, so the
  // table is seeded from the spec and the paste box is seeded from the table
  // (see `pasted` below). The
```

Replace the label and textarea (lines 286-287):

```svelte
      <label for="chart-paste">Data</label>
      <textarea
        id="chart-paste"
        bind:this={pasteEl}
        rows="12"
        placeholder="Paste a comma- or tab-separated table with a header row"
        value={pasted}
        oninput={onPaste}
      ></textarea>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run && npm run check)`
Expected: PASS across the whole suite. Watch the pre-existing `ChartBuilder.test.ts` tests that reopen a chart — `prefills from an existing chart and labels the action as an update`, the caption prefill tests, and the round-trip tests — none should change behaviour, but they now mount with a non-empty box. Also watch `App.test.ts`, which mounts the builder through `App`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ChartBuilder.svelte frontend/src/ChartBuilder.test.ts
git commit -m "feat: prefill the chart builder's data box when reopening a chart"
```

---

### Task 3: Changelog and verification

**Files:**
- Modify: `CHANGELOG.md` — the existing chart-builder bullet under `## [Unreleased]` → `### Added`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run the full verification suite**

Run:

```bash
go test ./. && go build -o /dev/null . && (cd frontend && npx vitest run && npm run check)
```

Expected: Go tests pass, the binary builds (this machine emits pre-existing macOS linker version warnings unrelated to any change — those are not a failure, any other noise is), every Vitest file passes, `svelte-check` reports no errors. Do not proceed on a failure.

- [ ] **Step 2: Amend the existing changelog bullet**

This is a refinement of an unreleased feature, not a new one, so it belongs in the bullet that already describes the builder rather than in a second bullet beside it. In `CHANGELOG.md`, find the existing sentence:

```
  cursor with the data inlined, so the document stays self-contained. Put the
  cursor back inside that block and Insert → Chart… reopens it with the
  controls filled in. A chart using anything the builder cannot express —
```

and replace it with:

```
  cursor with the data inlined, so the document stays self-contained. Put the
  cursor back inside that block and Insert → Chart… reopens it with the
  controls filled in and the data box holding the chart's own table, so a
  value can be corrected or a row added without re-pasting the lot. A chart
  using anything the builder cannot express —
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: note that reopening a chart now shows its data"
```

- [ ] **Step 4: Hand over the manual check**

jsdom has no layout engine, so nothing below can be asserted. Reproduce this list in the report as NOT DONE, for a human:

1. Insert a chart from a small pasted table. Reopen it: the box holds the same data, comma-separated, and the preview is unchanged.
2. Edit a value in the box; the preview updates and Update chart writes it to the document.
3. Add a row; it appears in the chart.
4. Delete one column name from the header so the header and rows disagree; the existing row-length error appears inline.
5. Select all and delete; the encode controls disappear, and Cancel leaves the document's chart exactly as it was.
6. Reopen a chart built from a tab-separated paste; it comes back comma-separated and still renders.
7. Reopen a chart with a few hundred rows; confirm the taller box scrolls acceptably and the dialog is still usable. This is the judgement the "no size threshold" decision rests on.

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: the serializer and its three asymmetries (delimiter, newline, type re-inference) → Task 1; the seeding, the label, the box height → Task 2; the changelog and the manual list → Task 3. The design's "what is deliberately not built" list is carried into the Global Constraints so a reviewer can catch an implementer who adds a confirmation dialog or a size threshold uninvited.

**Placeholder scan.** No TBDs; every code step carries the actual code, and every test step the actual assertions.

**Type consistency.** `toDelimited(table: DataTable): string` is defined in Task 1 and called with exactly that signature in Task 2. The private helper is `field`, not exported, and does not collide with anything in `dataTable.ts` (checked against `splitLine`, `isNumeric`, `inferType`, `parseDelimited`, `tableFromRows`). `seed.table` is `DataTable | null`, which is why Task 2's initialiser is guarded.

**One thing a reviewer should watch.** Task 2's Step 2 expects a partial RED — only the prefill test fails, because the three editing tests drive the textarea directly and would pass against today's code too. That is honest rather than a weak test: they exist to pin that editing the *prefilled* text reaches the spec, which is the behaviour the feature promises. If an implementer reports all five failing, something else is wrong.
