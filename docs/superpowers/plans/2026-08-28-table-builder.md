# Table Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Insert → Table… modal with an editable grid that writes a padded GFM pipe table into the document, inserting at the cursor or replacing the table the cursor is in.

**Architecture:** A pure `lib/pipeTable.ts` parses and serialises pipe tables (with alignment); `Editor.svelte` gains `enclosingTable()` on the Lezer `Table` node, mirroring `enclosingChartBlock()`; `TableBuilder.svelte` is a `Dialog`-based modal in the `ChartBuilder` mould that hands a `PipeTable` back; `App.svelte` wires it exactly as the chart path (`tableOpen`/`tableInitial`/`tableTarget`, insert-vs-replace, commit-time re-validation, mutual exclusion with the chart builder); `menu.go` adds the menu item.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest + jsdom, CodeMirror 6 / Lezer markdown (GFM tables already parsed), Wails v3 (Go menu → `menu:insert-table` event).

**Spec:** `docs/superpowers/specs/2026-08-28-table-builder-design.md`

## Global Constraints

- Frontend commands run from `frontend/`: `npx vitest run <file>` for one file, `npx vitest run` for all, `npx svelte-check` for types.
- Go: `go test ./. && go build -o /dev/null .` from the repo root (use `.`, not `./...`).
- No literal colours in CSS — use the palette variables in `frontend/public/style.css`; `styleContract.test.ts` fails the build otherwise.
- Never hand-edit `frontend/bindings/`; nothing in this plan changes a Go service, so no regeneration is needed.
- `wails3 task run` does not build. Real-app check is `wails3 task build && wails3 task run`, and confirm the binary contains a new symbol first: `strings "bin/Hermes Editor" | grep -c enclosingTable`.
- Commit after each task with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer; work on a branch `table-builder` off `main`.
- Copy: the menu item is `Table…`; buttons are `Insert table` / `Update table`; toasts are exactly the strings in the spec.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/pipeTable.ts` (new) | `PipeTable` type, `parsePipeTable`, `serializePipeTable`. Pure; no DOM. |
| `frontend/src/lib/pipeTable.test.ts` (new) | Parse/serialise/round-trip tests. |
| `frontend/src/Editor.svelte` | `enclosingTable()` beside `enclosingChartBlock()`. |
| `frontend/src/Editor.test.ts` | `enclosingTable` coverage, beside the `enclosingChartBlock` tests. |
| `frontend/src/TableBuilder.svelte` (new) | The modal: grid, alignment, add/remove, import, footer. |
| `frontend/src/TableBuilder.test.ts` (new) | Component tests under jsdom. |
| `frontend/src/App.svelte` | State, open/commit, guards, event, toolbar button, mount. |
| `frontend/src/App.test.ts` | Insert/replace/refusal/mutual-exclusion tests. |
| `frontend/public/style.css` | `.table-builder` rules. |
| `menu.go` | `Insert → Table…`. |
| `CLAUDE.md`, `README.md`, `docs/hermes-authoring.md`, `CHANGELOG.md`, `ROADMAP.md` | Docs. |

---

### Task 1: `lib/pipeTable.ts` — parse

**Files:**
- Create: `frontend/src/lib/pipeTable.ts`
- Create: `frontend/src/lib/pipeTable.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Alignment = 'left' | 'center' | 'right' | null
  export interface PipeTable { header: string[]; align: Alignment[]; rows: string[][] }
  export type ParsePipeResult =
    | { ok: true; table: PipeTable }
    | { ok: false; reason: 'no-delimiter' | 'empty' }
  export function parsePipeTable(text: string): ParsePipeResult
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/pipeTable.test.ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/pipeTable.test.ts`
Expected: FAIL — cannot resolve `./pipeTable`.

- [ ] **Step 3: Implement the parser**

```ts
// frontend/src/lib/pipeTable.ts
/**
 * GFM pipe tables as the table builder reads and writes them.
 *
 * Deliberately separate from dataTable.ts: that module infers a *type* per
 * column for chart encoding, and a markdown table has none — what it has
 * instead is an alignment per column, which has nowhere to live in
 * DataTable. Cells are raw markdown source; nothing here interprets them.
 */

export type Alignment = 'left' | 'center' | 'right' | null

export interface PipeTable {
  header: string[]
  /** One entry per column; null means no marker in the delimiter row. */
  align: Alignment[]
  rows: string[][]
}

export type ParsePipeResult =
  | { ok: true; table: PipeTable }
  | { ok: false; reason: 'no-delimiter' | 'empty' }

// A delimiter cell: optional colon, at least one dash, optional colon.
const DELIM_CELL = /^:?-+:?$/

/**
 * Splits one table row into cells. An escaped pipe (`\|`) is a literal pipe
 * inside a cell, not a boundary; one optional leading and trailing pipe are
 * dropped, as GFM does.
 */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let i = 0
  const s = line.trim()
  const start = s.startsWith('|') ? 1 : 0
  const end = s.endsWith('|') && !s.endsWith('\\|') ? s.length - 1 : s.length
  for (i = start; i < end; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cell += '|'
      i++
    } else if (ch === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell.trim())
  return cells
}

function alignmentOf(cell: string): Alignment {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return null
}

export function parsePipeTable(text: string): ParsePipeResult {
  const lines = text
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return { ok: false, reason: 'empty' }
  if (lines.length < 2) return { ok: false, reason: 'no-delimiter' }

  const header = splitRow(lines[0])
  const delim = splitRow(lines[1])
  if (delim.length !== header.length || !delim.every((c) => DELIM_CELL.test(c))) {
    return { ok: false, reason: 'no-delimiter' }
  }
  const align = delim.map(alignmentOf)
  const width = header.length
  const rows = lines.slice(2).map((line) => {
    const cells = splitRow(line).slice(0, width)
    while (cells.length < width) cells.push('')
    return cells
  })
  return { ok: true, table: { header, align, rows } }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/pipeTable.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git checkout -b table-builder
git add frontend/src/lib/pipeTable.ts frontend/src/lib/pipeTable.test.ts
git commit -m "feat: parse GFM pipe tables

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `lib/pipeTable.ts` — serialise and round trips

**Files:**
- Modify: `frontend/src/lib/pipeTable.ts`
- Modify: `frontend/src/lib/pipeTable.test.ts`

**Interfaces:**
- Consumes: `PipeTable`, `parsePipeTable` from Task 1.
- Produces: `export function serializePipeTable(table: PipeTable): string` — no trailing newline.

- [ ] **Step 1: Write the failing tests**

Append to `pipeTable.test.ts`:

```ts
import { serializePipeTable, type PipeTable } from './pipeTable'

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
```

Note on the first round-trip test: `'a \\| b'` in the source is the four characters `a \| b`. Serialising escapes the backslash's pipe again (`a \\| b` in output), and parsing unescapes exactly once, so the cell returns as `a \| b`. If the implementation below makes this fail, the escaping is the bug, not the test.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/pipeTable.test.ts`
Expected: FAIL — `serializePipeTable` is not exported.

- [ ] **Step 3: Implement the serialiser**

Append to `pipeTable.ts`:

```ts
/** Column width in code points, so an accented character still lines up. */
function width(s: string): number {
  return [...s].length
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|')
}

function pad(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - width(s)))
}

function delimiter(align: Alignment, w: number): string {
  switch (align) {
    case 'left':
      return ':' + '-'.repeat(w - 1)
    case 'right':
      return '-'.repeat(w - 1) + ':'
    case 'center':
      return ':' + '-'.repeat(w - 2) + ':'
    default:
      return '-'.repeat(w)
  }
}

/**
 * Writes a padded pipe table: every column as wide as its widest cell (never
 * narrower than 3, so the delimiter is always at least `---`), alignment
 * colons in the delimiter row, `|` inside a cell escaped. No trailing
 * newline — the caller decides how the block is placed.
 */
export function serializePipeTable(table: PipeTable): string {
  const cols = table.header.length
  const header = table.header.map(escapeCell)
  const rows = table.rows.map((r) => r.map(escapeCell))
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(3, width(header[c] ?? ''), ...rows.map((r) => width(r[c] ?? ''))),
  )
  const line = (cells: string[]) =>
    '| ' + cells.map((cell, c) => pad(cell, widths[c])).join(' | ') + ' |'
  return [
    line(header),
    line(widths.map((w, c) => delimiter(table.align[c] ?? null, w))),
    ...rows.map(line),
  ].join('\n')
}
```

How the escaping squares with both tests: the parser turns `\|` into `|` and the serialiser turns `|` into `\|`. A cell whose source already contains `\|` (the round-trip fixture) therefore serialises as `\\|`, which the parser reads as a literal `\` followed by an escaped pipe — `\|` again. Both directions hold with the code above.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/pipeTable.test.ts`
Expected: 16 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/pipeTable.ts frontend/src/lib/pipeTable.test.ts
git commit -m "feat: serialise padded GFM pipe tables

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `Editor.enclosingTable()`

**Files:**
- Modify: `frontend/src/Editor.svelte` (after `enclosingChartBlock`, ~line 350)
- Test: `frontend/src/Editor.test.ts` (has a `mountEditor()` helper returning `{ target, editor, text, cleanup }`, and an `EditorApi` interface at the top listing the component's exported functions)

**Interfaces:**
- Produces:
  ```ts
  export interface TableBlock { from: number; to: number; text: string }
  export function enclosingTable(): TableBlock | null
  ```

- [ ] **Step 1: Write the failing tests**

In `Editor.test.ts`, add to the `EditorApi` interface (beside `enclosingChartBlock`):

```ts
  enclosingTable(): { from: number; to: number; text: string } | null
```

Then add a describe after the `enclosingChartBlock` one, with its own `atPosition` helper of the same shape:

```ts
describe('Editor.enclosingTable', () => {
  const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |'
  const DOC = `# Results\n\n${TABLE}\n\nAfter.\n`

  function atPosition(pos: number) {
    const { target, editor, cleanup } = mountEditor()
    editor.setContent(DOC)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: pos } })
    return { editor, cleanup }
  }

  it('finds the table from a body cell, with its exact text', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('| 1'))
    const block = editor.enclosingTable()
    expect(block).not.toBeNull()
    expect(block!.text).toBe(TABLE)
    expect(DOC.slice(block!.from, block!.to)).toBe(TABLE)
    cleanup()
  })

  it('finds the table from the very start of the header row', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('| a'))
    expect(editor.enclosingTable()).not.toBeNull()
    cleanup()
  })

  it('finds the table from the end of the last row', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('| 2 |') + '| 2 |'.length)
    expect(editor.enclosingTable()).not.toBeNull()
    cleanup()
  })

  it('finds nothing in prose', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('After'))
    expect(editor.enclosingTable()).toBeNull()
    cleanup()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/Editor.test.ts -t enclosingTable`
Expected: FAIL — `editor.enclosingTable is not a function`.

- [ ] **Step 3: Implement `enclosingTable`**

In `Editor.svelte`, after `enclosingChartBlock`:

```ts
  export interface TableBlock {
    from: number
    to: number
    text: string
  }

  /**
   * The GFM table containing the cursor, or null.
   *
   * Same two load-bearing details as enclosingChartBlock, for the same
   * reasons: forceParsing first, because a table late in a long paper is not
   * in the tree until parsing is forced; and resolveInner on both sides, so
   * a cursor at the exact start or exact end of the table still counts. The
   * Lezer GFM grammar lang-markdown installs already produces `Table`.
   */
  export function enclosingTable(): TableBlock | null {
    forceParsing(view, view.state.doc.length, 5000)
    const tree = syntaxTree(view.state)
    const pos = view.state.selection.main.head

    for (const side of [1, -1] as const) {
      let node: SyntaxNode | null = tree.resolveInner(pos, side)
      while (node && node.name !== 'Table') node = node.parent
      if (!node) continue
      return { from: node.from, to: node.to, text: view.state.doc.sliceString(node.from, node.to) }
    }
    return null
  }
```

- [ ] **Step 4: Run to verify pass, and type-check**

Run: `cd frontend && npx vitest run src/Editor.test.ts && npx svelte-check --threshold error 2>&1 | tail -3`
Expected: all Editor tests pass (4 new), 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Editor.svelte frontend/src/Editor.test.ts
git commit -m "feat: find the GFM table around the cursor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `TableBuilder.svelte`

**Files:**
- Create: `frontend/src/TableBuilder.svelte`
- Create: `frontend/src/TableBuilder.test.ts`
- Modify: `frontend/public/style.css` (after the `.chart-builder` rules, ~line 575)

**Interfaces:**
- Consumes: `PipeTable`, `Alignment` (Task 1); `parseDelimited` from `lib/dataTable.ts` (`{ ok: true, table: { columns: {name}[], rows: Record<string, string|number>[] } } | { ok: false, message }`); `Dialog.svelte` (`open`, `label`, `class`, `onclose`, `children`, `footer` snippet).
- Produces: component with props `{ initial: PipeTable | null; oncommit: (table: PipeTable) => void; oncancel: () => void }`. DOM contract the App tests rely on: root dialog has class `table-builder`; header inputs `input.th-cell`, body inputs `input.td-cell` with `data-row`/`data-col`; alignment buttons `button.align[data-col][data-align]`; `+ Row`, `+ Column`, `Cancel`, `Insert table`/`Update table` buttons; import textarea `#table-import`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/TableBuilder.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import TableBuilder from './TableBuilder.svelte'
import type { PipeTable } from './lib/pipeTable'

function mountBuilder(initial: PipeTable | null = null) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const oncommit = vi.fn()
  const oncancel = vi.fn()
  const cmp = mount(TableBuilder, { target, props: { initial, oncommit, oncancel } })
  flushSync()
  return {
    target,
    oncommit,
    oncancel,
    cleanup: () => {
      unmount(cmp)
      target.remove()
    },
  }
}

const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

const headers = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>('input.th-cell')]
const cells = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>('input.td-cell')]

describe('TableBuilder', () => {
  it('starts as 3 named columns and 2 empty rows', () => {
    const { target, cleanup } = mountBuilder()
    expect(headers(target).map((i) => i.value)).toEqual(['Column 1', 'Column 2', 'Column 3'])
    expect(cells(target)).toHaveLength(6)
    // The default headers are text, so this is a committable skeleton.
    expect(button(target, 'Insert table').disabled).toBe(false)
    cleanup()
  })

  it('disables commit only once every cell, header included, is empty', () => {
    const { target, cleanup } = mountBuilder()
    for (const input of headers(target)) type(input, '')
    expect(button(target, 'Insert table').disabled).toBe(true)
    type(cells(target)[4], 'x')
    expect(button(target, 'Insert table').disabled).toBe(false)
    cleanup()
  })

  it('focuses the first header cell on open', () => {
    const { target, cleanup } = mountBuilder()
    expect(document.activeElement).toBe(headers(target)[0])
    cleanup()
  })

  it('commits the edited grid as a PipeTable', () => {
    const { target, oncommit, cleanup } = mountBuilder()
    type(headers(target)[0], 'Name')
    type(cells(target)[0], 'Alice')
    type(cells(target)[3], 'Bob')
    button(target, 'Insert table').click()
    expect(oncommit).toHaveBeenCalledWith({
      header: ['Name', 'Column 2', 'Column 3'],
      align: [null, null, null],
      rows: [['Alice', '', ''], ['Bob', '', '']],
    })
    cleanup()
  })

  it('shows Update and the initial table when reopening one', () => {
    const initial: PipeTable = { header: ['a', 'b'], align: ['right', null], rows: [['1', '2']] }
    const { target, cleanup } = mountBuilder(initial)
    expect(headers(target).map((i) => i.value)).toEqual(['a', 'b'])
    expect(cells(target).map((i) => i.value)).toEqual(['1', '2'])
    expect(button(target, 'Update table').disabled).toBe(false)
    expect(target.querySelector('button.align[data-col="0"][data-align="right"]')?.getAttribute('aria-pressed')).toBe('true')
    cleanup()
  })

  it('adds and removes rows and columns, never removing the last column', () => {
    const { target, cleanup } = mountBuilder()
    button(target, '+ Row').click()
    flushSync()
    expect(cells(target)).toHaveLength(9)
    button(target, '+ Column').click()
    flushSync()
    expect(headers(target).map((i) => i.value)).toEqual(['Column 1', 'Column 2', 'Column 3', 'Column 4'])
    expect(cells(target)).toHaveLength(12)

    target.querySelector<HTMLButtonElement>('button.remove-row[data-row="0"]')!.click()
    flushSync()
    expect(cells(target)).toHaveLength(8)

    for (let i = 0; i < 3; i++) {
      target.querySelector<HTMLButtonElement>('button.remove-col[data-col="0"]')!.click()
      flushSync()
    }
    expect(headers(target)).toHaveLength(1)
    expect(target.querySelector<HTMLButtonElement>('button.remove-col[data-col="0"]')!.disabled).toBe(true)
    cleanup()
  })

  it('toggles alignment per column and commits it', () => {
    const { target, oncommit, cleanup } = mountBuilder()
    type(cells(target)[0], 'x')
    target.querySelector<HTMLButtonElement>('button.align[data-col="1"][data-align="center"]')!.click()
    flushSync()
    button(target, 'Insert table').click()
    expect(oncommit.mock.calls[0][0].align).toEqual([null, 'center', null])
    cleanup()
  })

  it('Enter on the last row adds a row and moves into it', () => {
    const { target, cleanup } = mountBuilder()
    const last = cells(target)[3]
    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    flushSync()
    expect(cells(target)).toHaveLength(9)
    expect(document.activeElement).toBe(cells(target)[6])
    cleanup()
  })

  it('imports delimited text, replacing the grid', () => {
    const { target, oncommit, cleanup } = mountBuilder()
    button(target, 'Import').click()
    flushSync()
    const box = target.querySelector<HTMLTextAreaElement>('#table-import')!
    box.value = 'dose,response\n0,1\n5,2\n'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(headers(target).map((i) => i.value)).toEqual(['dose', 'response'])
    expect(cells(target).map((i) => i.value)).toEqual(['0', '1', '5', '2'])
    button(target, 'Insert table').click()
    expect(oncommit.mock.calls[0][0].rows).toEqual([['0', '1'], ['5', '2']])
    cleanup()
  })

  it('reports import text that does not parse and leaves the grid alone', () => {
    const { target, cleanup } = mountBuilder()
    type(cells(target)[0], 'keep')
    button(target, 'Import').click()
    flushSync()
    const box = target.querySelector<HTMLTextAreaElement>('#table-import')!
    box.value = 'only a header'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(target.querySelector('.field-error')).not.toBeNull()
    expect(cells(target)[0].value).toBe('keep')
    cleanup()
  })

  it('Cancel calls oncancel', () => {
    const { target, oncancel, cleanup } = mountBuilder()
    button(target, 'Cancel').click()
    expect(oncancel).toHaveBeenCalled()
    cleanup()
  })
})
```

(`parseDelimited('only a header')` is refused: a first line with whitespace and no comma or tab is treated as pasted prose, with the message "Expected a comma- or tab-separated table with a header row.")

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/TableBuilder.test.ts`
Expected: FAIL — cannot resolve `./TableBuilder.svelte`.

- [ ] **Step 3: Write the component**

```svelte
<!-- frontend/src/TableBuilder.svelte -->
<script lang="ts">
  import { tick, untrack } from 'svelte'
  import Dialog from './Dialog.svelte'
  import { parseDelimited } from './lib/dataTable'
  import type { Alignment, PipeTable } from './lib/pipeTable'

  interface Props {
    /** The table under the cursor, or null for a new one. */
    initial: PipeTable | null
    oncommit: (table: PipeTable) => void
    oncancel: () => void
  }

  const { initial, oncommit, oncancel }: Props = $props()

  // Read once at mount, as ChartBuilder does: the modal is recreated on each
  // open, never updated, so nothing here reacts to a later `initial`.
  const seed = untrack(() =>
    initial
      ? { header: [...initial.header], align: [...initial.align], rows: initial.rows.map((r) => [...r]) }
      : { header: ['Column 1', 'Column 2', 'Column 3'], align: [null, null, null], rows: [['', '', ''], ['', '', '']] },
  )

  let header = $state<string[]>(seed.header)
  let align = $state<Alignment[]>(seed.align)
  let rows = $state<string[][]>(seed.rows)

  const ALIGNMENTS: { value: Alignment; label: string; title: string }[] = [
    { value: null, label: '–', title: 'No alignment' },
    { value: 'left', label: '⟸', title: 'Align left' },
    { value: 'center', label: '⟺', title: 'Centre' },
    { value: 'right', label: '⟹', title: 'Align right' },
  ]

  const empty = $derived(header.every((h) => h.trim() === '') && rows.every((r) => r.every((c) => c.trim() === '')))

  function addRow() {
    rows = [...rows, header.map(() => '')]
  }
  function removeRow(i: number) {
    rows = rows.filter((_, r) => r !== i)
  }
  function addColumn() {
    header = [...header, `Column ${header.length + 1}`]
    align = [...align, null]
    rows = rows.map((r) => [...r, ''])
  }
  function removeColumn(c: number) {
    if (header.length <= 1) return
    header = header.filter((_, i) => i !== c)
    align = align.filter((_, i) => i !== c)
    rows = rows.map((r) => r.filter((_, i) => i !== c))
  }
  function setAlign(c: number, value: Alignment) {
    align = align.map((a, i) => (i === c ? value : a))
  }

  let grid: HTMLElement | undefined = $state()

  function cellInput(r: number, c: number): HTMLInputElement | null {
    return grid?.querySelector<HTMLInputElement>(`input.td-cell[data-row="${r}"][data-col="${c}"]`) ?? null
  }

  // Enter moves down a row; on the last row it adds one first. Tab keeps the
  // browser's own order, which is already reading order.
  async function onCellKey(e: KeyboardEvent, r: number, c: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (r === rows.length - 1) addRow()
    await tick()
    cellInput(r + 1, c)?.focus()
  }

  let importOpen = $state(false)
  let importError = $state('')

  function onImport(e: Event) {
    const text = (e.currentTarget as HTMLTextAreaElement).value
    if (text.trim() === '') {
      importError = ''
      return
    }
    const result = parseDelimited(text)
    if (!result.ok) {
      importError = result.message
      return
    }
    importError = ''
    const names = result.table.columns.map((col) => col.name)
    header = names
    align = names.map(() => null)
    rows = result.table.rows.map((row) => names.map((n) => String(row[n] ?? '')))
  }

  function commit() {
    oncommit({ header: [...header], align: [...align], rows: rows.map((r) => [...r]) })
  }

  // Same reason as ChartBuilder's paste box: the modal does not stop keystrokes
  // reaching the editor beneath it if focus is left behind. Runs once.
  let firstHeader: HTMLInputElement | undefined = $state()
  $effect(() => {
    firstHeader?.focus()
  })
</script>

<Dialog open label="Table builder" class="table-builder" onclose={oncancel}>
  <h2>Table</h2>

  <div class="table-grid" bind:this={grid}>
    <table>
      <thead>
        <tr class="align-row">
          {#each header as _, c (c)}
            <td>
              <div class="align-group" role="group" aria-label={`Alignment for column ${c + 1}`}>
                {#each ALIGNMENTS as a (a.value ?? 'none')}
                  <button
                    type="button"
                    class="align"
                    data-col={c}
                    data-align={a.value ?? 'none'}
                    aria-pressed={align[c] === a.value ? 'true' : 'false'}
                    title={a.title}
                    onclick={() => setAlign(c, a.value)}>{a.label}</button>
                {/each}
              </div>
            </td>
          {/each}
          <td></td>
        </tr>
        <tr>
          {#each header as h, c (c)}
            <th>
              {#if c === 0}
                <input class="th-cell" bind:this={firstHeader} value={h} aria-label={`Header ${c + 1}`}
                  oninput={(e) => (header[c] = (e.currentTarget as HTMLInputElement).value)} />
              {:else}
                <input class="th-cell" value={h} aria-label={`Header ${c + 1}`}
                  oninput={(e) => (header[c] = (e.currentTarget as HTMLInputElement).value)} />
              {/if}
            </th>
          {/each}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row, r (r)}
          <tr>
            {#each row as cell, c (c)}
              <td>
                <input class="td-cell" data-row={r} data-col={c} value={cell}
                  aria-label={`Row ${r + 1}, column ${c + 1}`}
                  oninput={(e) => (rows[r][c] = (e.currentTarget as HTMLInputElement).value)}
                  onkeydown={(e) => void onCellKey(e, r, c)} />
              </td>
            {/each}
            <td>
              <button type="button" class="remove-row" data-row={r} title="Remove row" aria-label={`Remove row ${r + 1}`}
                onclick={() => removeRow(r)}>✕</button>
            </td>
          </tr>
        {/each}
        <tr class="remove-col-row">
          {#each header as _, c (c)}
            <td>
              <button type="button" class="remove-col" data-col={c} title="Remove column"
                aria-label={`Remove column ${c + 1}`} disabled={header.length <= 1}
                onclick={() => removeColumn(c)}>✕</button>
            </td>
          {/each}
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="table-actions">
    <button type="button" onclick={addRow}>+ Row</button>
    <button type="button" onclick={addColumn}>+ Column</button>
    <button type="button" class="link-button" aria-expanded={importOpen} onclick={() => (importOpen = !importOpen)}>Import</button>
  </div>

  {#if importOpen}
    <section class="table-import">
      <label for="table-import">Paste comma- or tab-separated text with a header row; it replaces the grid</label>
      <textarea id="table-import" rows="5" oninput={onImport}></textarea>
      {#if importError}
        <p class="field-error" role="alert">{importError}</p>
      {/if}
    </section>
  {/if}

  {#snippet footer()}
    <button onclick={oncancel}>Cancel</button>
    <button class="primary" disabled={empty} onclick={commit}>
      {initial ? 'Update table' : 'Insert table'}
    </button>
  {/snippet}
</Dialog>
```

Two things to verify while writing, rather than assume: (1) `Dialog`'s `focusDefaultButton` focuses `.modal-buttons .primary` when opened; the `$effect` focusing `firstHeader` runs after mount and must win — ChartBuilder relies on the same ordering for its paste box, so if the focus test fails, look at how ChartBuilder's `pasteEl` effect is ordered relative to Dialog's and match it. (2) The `{#each rows as row, r (r)}` inner `rows[r][c] = …` writes need `rows` to be a `$state` array (it is) — Svelte 5 proxies nested arrays, so the assignment is reactive; confirm the commit test sees the typed values.

- [ ] **Step 4: Add the styles**

Append after the `.chart-builder` rules in `frontend/public/style.css`:

```css
/* Table builder — same dialog shell as the chart builder, sized for a grid. */
.table-builder {
  width: min(56rem, 90vw);
  max-width: min(56rem, 90vw);
  text-align: left;
}
.table-builder h2 { margin-bottom: 16px; }
.table-grid { overflow-x: auto; margin-bottom: 12px; }
.table-grid table { border-collapse: collapse; }
.table-grid th, .table-grid td { padding: 2px; }
.table-grid input {
  width: 100%;
  min-width: 8rem;
  padding: 4px 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  font: inherit;
}
.table-grid input.th-cell { font-weight: 600; }
.align-group { display: flex; gap: 2px; }
.align-group .align { padding: 0 6px; font-size: 12px; }
.align-group .align[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
.table-grid .remove-row, .table-grid .remove-col { padding: 0 6px; font-size: 12px; color: var(--muted); }
.table-actions { display: flex; gap: 8px; margin-bottom: 12px; }
.table-import label { display: block; margin-bottom: 4px; font-size: 13px; color: var(--muted); }
.table-import textarea { width: 100%; font-family: monospace; }
.table-builder .field-error { color: var(--cite-error-fg); margin-top: 8px; }
```

Every variable used above (`--border`, `--bg`, `--fg`, `--accent`, `--on-accent`, `--muted`, `--cite-error-fg`) exists in the palette at the top of `style.css`. `styleContract.test.ts` fails on a literal colour, so run it.

- [ ] **Step 5: Run to verify pass**

Run: `cd frontend && npx vitest run src/TableBuilder.test.ts src/lib/styleContract.test.ts && npx svelte-check --threshold error 2>&1 | tail -3`
Expected: all TableBuilder tests pass, style contract passes, 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/TableBuilder.svelte frontend/src/TableBuilder.test.ts frontend/public/style.css
git commit -m "feat: a table builder modal with an editable grid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: App wiring, menu item, toolbar button

**Files:**
- Modify: `frontend/src/App.svelte` (imports ~line 36; state after `chartTarget` ~line 234; `openChartBuilder` guard ~line 242; guards at lines ~193, 319, 335, 345, 404, 466, 488, 602; events ~line 614; toolbar ~line 664; mount ~line 745)
- Modify: `menu.go` (~line 131, after Chart…)
- Modify: `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `TableBuilder` (Task 4), `enclosingTable` (Task 3), `parsePipeTable`/`serializePipeTable` (Tasks 1–2), `editor.textInRange`, `editor.replaceRange`, `editor.insertBlockAtCursor`.

- [ ] **Step 1: Write the failing tests**

Add to `App.test.ts`, a new describe after the chart builder one (reuse its `openDoc` shape — copy it, since each describe owns its helper):

```ts
describe('table builder', () => {
  const WITH_TABLE = ['# Results', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', 'After.', ''].join('\n')

  async function openDoc(content: string) {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/paper.md', content })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Results'))
    return target
  }

  function typeCell(target: HTMLElement, row: number, col: number, value: string) {
    const input = target.querySelector<HTMLInputElement>(`input.td-cell[data-row="${row}"][data-col="${col}"]`)!
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
  }

  it('opens from the menu and from the toolbar', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.querySelector('.table-builder')).not.toBeNull()
    buttonByText(target, 'Cancel')!.click()
    flushSync()
    expect(target.querySelector('.table-builder')).toBeNull()
    buttonByText(target, 'Table')!.click()
    flushSync()
    expect(target.querySelector('.table-builder')).not.toBeNull()
  })

  it('inserts a padded table at the cursor as its own block', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    typeCell(target, 0, 0, 'x')
    buttonByText(target, 'Insert table')!.click()
    flushSync()
    expect(view.state.doc.toString()).toContain('| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| x        |          |          |')
    expect(target.querySelector('.table-builder')).toBeNull()
  })

  it('replaces the table under the cursor', async () => {
    const target = await openDoc(WITH_TABLE)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: WITH_TABLE.indexOf('| 1') } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Update table')
    typeCell(target, 0, 1, '42')
    buttonByText(target, 'Update table')!.click()
    flushSync()
    const doc = view.state.doc.toString()
    expect(doc).toContain('| a   | b   |\n| --- | --- |\n| 1   | 42  |')
    expect(doc).not.toContain('| 1 | 2 |')
    expect(doc).toContain('After.')
  })

  it('refuses to commit when the target moved while open', async () => {
    const target = await openDoc(WITH_TABLE)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const inside = WITH_TABLE.indexOf('| 1')
    view.dispatch({ selection: { anchor: inside } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    view.dispatch({ changes: { from: inside, to: inside, insert: 'XYZ\n\n' } })
    const stray = view.state.doc.toString()
    buttonByText(target, 'Update table')!.click()
    flushSync()
    expect(target.textContent).toContain("wasn't changed")
    expect(view.state.doc.toString()).toBe(stray)
    expect(target.querySelector('.table-builder')).toBeNull()
  })

  it('a second menu:insert-table while open is a no-op', async () => {
    const target = await openDoc(WITH_TABLE)
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: WITH_TABLE.indexOf('After') } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Insert table')
    view.dispatch({ selection: { anchor: WITH_TABLE.indexOf('| 1') } })
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.querySelectorAll('.table-builder')).toHaveLength(1)
    expect(target.textContent).toContain('Insert table')
  })

  it('the chart and table builders refuse to open over each other', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-table']({ data: null })
    flushSync()
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).toBeNull()
    buttonByText(target, 'Cancel')!.click()
    flushSync()
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.querySelector('.table-builder')).toBeNull()
    expect(target.querySelector('.chart-builder')).not.toBeNull()
  })

  it('does not open over the welcome pane', async () => {
    recents.current = ['/tmp/paper.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:insert-table']({ data: null })
    flushSync()
    expect(target.querySelector('.table-builder')).toBeNull()
  })

  it('refuses to quit audibly while the builder is open', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    listeners['menu:insert-table']({ data: null })
    flushSync()
    listeners['close:confirm']({ data: null })
    flushSync()
    expect(target.textContent).toContain('Finish or cancel the table before quitting')
    expect(target.querySelector('.table-builder')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/App.test.ts -t "table builder"`
Expected: FAIL — `listeners['menu:insert-table']` is not a function.

- [ ] **Step 3: Wire App.svelte**

Imports (beside `ChartBuilder`):

```ts
  import TableBuilder from './TableBuilder.svelte'
  import { parsePipeTable, serializePipeTable, type PipeTable } from './lib/pipeTable'
```

State and functions, directly after `commitChart`:

```ts
  let tableOpen = $state(false)
  let tableInitial: PipeTable | null = $state(null)
  let tableTarget: { from: number; to: number } | null = null

  // Mirrors openChartBuilder guard for guard; see the comments there.
  function openTableBuilder() {
    if (tableOpen || chartOpen || newOpen) return
    if (showWelcome) return
    if (pendingAction) return

    const block = editor.enclosingTable()
    if (!block) {
      tableInitial = null
      tableTarget = null
      tableOpen = true
      return
    }
    const result = parsePipeTable(block.text)
    if (!result.ok) {
      // Rare: Lezer only produces a Table for text that is one. Refuse rather
      // than open a fresh builder targeted at a block we could not read.
      toast("That table couldn't be read, so it can't be opened here.")
      return
    }
    tableInitial = result.table
    tableTarget = { from: block.from, to: block.to }
    tableOpen = true
  }

  function closeTableBuilder() {
    tableOpen = false
    tableInitial = null
    tableTarget = null
  }

  function commitTable(table: PipeTable) {
    const text = serializePipeTable(table)
    if (tableTarget) {
      // Same safety net as commitChart: the range was captured when the
      // builder opened and is not remapped, so prove it still holds a table
      // before overwriting it.
      const current = editor.textInRange(tableTarget.from, tableTarget.to)
      if (!parsePipeTable(current).ok) {
        toast("That table moved while the builder was open, so it wasn't changed.")
        closeTableBuilder()
        return
      }
      editor.replaceRange(tableTarget.from, tableTarget.to, text)
    } else {
      editor.insertBlockAtCursor(text + '\n')
    }
    closeTableBuilder()
  }
```

Guards — edit each existing site:

- `openChartBuilder`: after `if (chartOpen) return` add `if (tableOpen) return`.
- `insertCitation` (`if (chartOpen) return`) → `if (chartOpen || tableOpen) return`.
- `applyFormat`, `insertCodeBlock`, and the third `showWelcome || chartOpen` site → `showWelcome || chartOpen || tableOpen`.
- `requestNew`, `requestOpen` and the welcome-pane open (`chartOpen || newOpen`) → `chartOpen || tableOpen || newOpen`.
- `close:confirm` handler: after the `chartOpen` block add
  ```ts
      if (tableOpen) {
        toast('Finish or cancel the table before quitting.')
        return
      }
  ```
- New Document open path: find where `newOpen = true` is guarded and make sure `openTableBuilder`'s `newOpen` check has a mirror — `requestNew` already refuses while `tableOpen`, which is the mirror.

Event, beside `menu:insert-chart`:

```ts
    Events.On('menu:insert-table', () => openTableBuilder())
```

Toolbar, after the Chart button:

```svelte
    <button onclick={openTableBuilder}>Table</button>
```

Mount, after the `{#if chartOpen}` block:

```svelte
  {#if tableOpen}
    <TableBuilder initial={tableInitial} oncommit={commitTable} oncancel={closeTableBuilder} />
  {/if}
```

- [ ] **Step 4: Add the menu item**

In `menu.go`, after the `Chart…` item:

```go
	insert.Add("Table…").OnClick(func(*application.Context) {
		app.Event.Emit("menu:insert-table", nil)
	})
```

- [ ] **Step 5: Run everything**

Run: `cd frontend && npx vitest run && npx svelte-check --threshold error 2>&1 | tail -3 && cd .. && go test ./. && go build -o /dev/null .`
Expected: all vitest files pass (including the Task 3 `enclosingTable` tests now green), 0 type errors, Go ok.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.svelte frontend/src/App.test.ts menu.go
git commit -m "feat: Insert → Table… opens the table builder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Real-app check

**Files:** none changed unless the check finds a bug.

- [ ] **Step 1: Build and confirm the binary carries the feature**

Run: `wails3 task build && strings "bin/Hermes Editor" | grep -c 'table-builder'`
Expected: a count ≥ 1 (the class name is in the embedded bundle).

- [ ] **Step 2: Launch and exercise**

Run: `wails3 task run`, then in the app: open `docs/test-document.md`; Insert → Table… from prose → type into cells, Enter on the last row adds one, ✕ removes, alignment toggles, Insert → the padded table appears and renders in the preview. Put the cursor inside that table → Insert → Table… shows Update table with the values → change one → Update → source updated, nothing duplicated. Toolbar **Table** button does the same. Import: open Import, paste `docs/sample-data.csv`'s content → grid replaced. Esc cancels. With the builder open, ⌘Q toasts "Finish or cancel the table before quitting."

- [ ] **Step 3: Fix anything found, with a test first, then commit**

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (the events sentence, line 28; the `ChartBuilder.svelte` bullet)
- Modify: `README.md` (feature list, after the Charts bullet ~line 15)
- Modify: `docs/hermes-authoring.md` (a `## Tables` section before `## Charts`, ~line 120)
- Modify: `CHANGELOG.md` (Unreleased → Added)
- Modify: `ROADMAP.md` (tick the item at ~line 554)

- [ ] **Step 1: CLAUDE.md**

In the events sentence change `` `menu:insert-citation` and `menu:insert-chart` (from the Insert menu) `` to `` `menu:insert-citation`, `menu:insert-chart` and `menu:insert-table` (from the Insert menu) ``. In the `ChartBuilder.svelte` bullet append: `` `TableBuilder.svelte` follows the same open/commit shape for GFM tables — `Editor.svelte`'s `enclosingTable` finds the Lezer `Table` node, `lib/pipeTable.ts` parses and serialises (padded, with alignment; cells are raw markdown source), and `commitTable` re-validates the range like `commitChart` does. ``

- [ ] **Step 2: README.md**

After the Charts bullet add:

```markdown
- **Tables** — a builder with an editable grid, per-column alignment and
  CSV/TSV import writes a padded pipe table, and reopens the one under the
  cursor for editing.
```

- [ ] **Step 3: docs/hermes-authoring.md**

Insert before `## Charts`:

```markdown
## Tables

GFM pipe tables render as tables. Insert → Table… opens a grid: type into the
cells, add or remove rows and columns, set a column's alignment, or paste
comma- or tab-separated text under Import. Insert writes a padded table at
the cursor; with the cursor inside an existing table the same command opens
it for editing and Update replaces it. Cells hold ordinary markdown, so
`**bold**`, links and `[@citations]` work inside them.

| Sample   | n   | Mean |
| :------- | --: | ---: |
| Control  |  12 |  4.1 |
| Treated  |  11 |  6.3 |
```

- [ ] **Step 4: CHANGELOG.md**

Under `## [Unreleased]` → `### Added`, after the outline entry:

```markdown
- A table builder: Insert → Table… (or the toolbar's Table button) opens an
  editable grid with per-column alignment and CSV/TSV import, and writes a
  padded pipe table; run it with the cursor inside a table to edit that one.
```

- [ ] **Step 5: ROADMAP.md**

Replace the item's `- [ ] A table builder.` opening with `- [x] **A table builder.** Done 2026-08-28, unreleased.` and append to the item's text, wrapped at 78 columns in the surrounding style:

```
      Built as the roadmap predicted, with one deliberate departure: alignment
      and cell text got their own `lib/pipeTable.ts` (parse and padded
      serialise, cells as raw markdown source) rather than stretching
      `DataTable`, whose columns carry a chart *type* instead. The grid is an
      editable one, not a paste box with a preview; import through
      `parseDelimited` replaces the grid one way. `Editor.enclosingTable`
      reads the Lezer `Table` node the GFM grammar already produces, so
      opening with the cursor in a table edits it in place, and `commitTable`
      re-validates the range as `commitChart` does.
```

Use the guarded-splice discipline from CLAUDE.md: `python3` with `assert s.count(old) == 1`, then confirm `grep -c '^- \['` is unchanged and `grep '^## '` is unchanged.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs/hermes-authoring.md CHANGELOG.md ROADMAP.md
git commit -m "docs: the table builder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Then hand over to `superpowers:finishing-a-development-branch`.
