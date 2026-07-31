# Hermes v0.4 Formatting Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select text in the editor and apply markdown formatting to it — make a line a heading, make a block of lines a list, make a phrase bold.

**Architecture:** Pure CodeMirror `StateCommand`s in `frontend/src/lib/markdownCommands.ts`, with `Editor.svelte` reduced to a thin passthrough. Block commands (headings, lists, quote) rewrite whole lines; inline commands (bold, italic, code, strike) wrap ranges. Detection is hybrid: the Lezer syntax tree guards fenced and inline code, while explicit line logic handles frontmatter, which the tree misreads as a setext heading. Spec: `docs/superpowers/specs/2026-07-31-formatting-commands-design.md`.

**Tech Stack:** CodeMirror 6 (`@codemirror/state`, `@codemirror/language`, `@codemirror/lang-markdown`), Svelte 5 runes, Wails v3 menus and events, Vitest.

## Global Constraints

- TDD everywhere: failing test → verify it fails → implement → verify it passes → commit.
- **No new npm packages.** Everything needed is already installed transitively. Task 1 promotes `@codemirror/state` and `@codemirror/language` to explicit `dependencies` because the code imports them directly.
- **Every command produces exactly one transaction**, so one action is one undo step.
- **Uniform toggle rule** (this single rule implements all three settled semantics): survey every target first; if *all* targets already have the format, remove it from all; otherwise apply it to all. Never decide per-line inside a multi-line selection.
- **Guards are absolute:** a command must never modify text inside fenced code, inline code, or the frontmatter block. Formatting inside a ` ```vega-lite ` block corrupts the chart; formatting the frontmatter silently breaks the bibliography.
- Marks: bold `**`, italic `*`, inline code `` ` ``, strikethrough `~~`.
- Accelerators are owned by `menu.go` and emit events. **Do not add a CodeMirror keymap** for these — AppKit intercepts the chord before the webview sees it, so a keymap binding would be dead code.
- Frontend commands run in `frontend/`; Go gates at the repo root: `go test ./.`, `go build -o /dev/null .` (never `./...`), `gofmt -l` clean on touched files.
- `npm run check` must stay at 0 errors.
- Verified by probe (do not re-derive): the Lezer markdown tree parses fully headlessly under Vitest. Node names are `FencedCode`/`CodeText` for fenced blocks, `InlineCode`, `StrongEmphasis`, `ATXHeading2`, `ListItem`/`BulletList`. Frontmatter resolves as `SetextHeading2` — the tree has no frontmatter concept, hence the separate line-based guard.

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/markdownCommands.ts` + `.test.ts` | Guards, line model, and all block/inline `StateCommand`s |
| `frontend/src/Editor.svelte` (modify) | `runCommand(cmd)` passthrough |
| `frontend/src/App.svelte` (modify) | `menu:format` handler, focus guard, command lookup table |
| `menu.go` (modify) | Format menu with accelerators, emitting `menu:format` |
| `frontend/package.json` (modify) | Promote two transitive CodeMirror deps to explicit |
| `docs/visual-test.md`, `CLAUDE.md` (modify) | Manual verification section and architecture note |

---

### Task 1: Position guards

**Files:**
- Create: `frontend/src/lib/markdownCommands.ts`, `frontend/src/lib/markdownCommands.test.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `isProtected(state: EditorState, pos: number): boolean` — true when `pos` is inside fenced code, inline code, or a leading frontmatter block. Tasks 2 and 3 call this before touching any line or range.

- [ ] **Step 1: Promote the transitive dependencies**

In `frontend/`, add to `dependencies` in `package.json` (keep alphabetical order with the existing entries):

```json
"@codemirror/language": "^6.11.3",
"@codemirror/state": "^6.5.2",
```

Then run `cd frontend && npm install` and confirm it reports no package additions beyond deduping — these are already present transitively.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/lib/markdownCommands.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { isProtected } from './markdownCommands'

function stateOf(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown()] })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

describe('isProtected', () => {
  it('protects text inside a fenced code block', () => {
    const doc = 'Text\n\n```vega-lite\n{"mark": "bar"}\n```\n'
    expect(isProtected(stateOf(doc), doc.indexOf('"mark"'))).toBe(true)
  })

  it('protects inline code', () => {
    const doc = 'Run `npm test` now'
    expect(isProtected(stateOf(doc), doc.indexOf('npm'))).toBe(true)
  })

  it('protects the frontmatter block including its fences', () => {
    const doc = '---\nbibliography: refs.bib\n---\n# Title'
    const state = stateOf(doc)
    expect(isProtected(state, 0)).toBe(true)
    expect(isProtected(state, doc.indexOf('bibliography'))).toBe(true)
  })

  it('leaves ordinary prose alone', () => {
    const doc = '---\nbibliography: refs.bib\n---\n# Title\n\nProse here.'
    expect(isProtected(stateOf(doc), doc.indexOf('Prose'))).toBe(false)
  })

  it('does not treat a mid-document --- as frontmatter', () => {
    const doc = 'Intro\n\n---\n\nMore text'
    expect(isProtected(stateOf(doc), doc.indexOf('More'))).toBe(false)
  })

  it('does not treat an unterminated leading --- as frontmatter', () => {
    const doc = '---\nnot closed\n\ntext'
    expect(isProtected(stateOf(doc), doc.indexOf('text'))).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify FAIL** — `cd frontend && npx vitest run src/lib/markdownCommands.test.ts`. Expected: fails with "Cannot find module './markdownCommands'".

- [ ] **Step 4: Implement**

Create `frontend/src/lib/markdownCommands.ts`:

```ts
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

// Lezer markdown node names covering fenced blocks and inline spans. The
// syntax tree is already maintained for highlighting, so querying it is free.
const CODE_NODES = new Set(['FencedCode', 'CodeText', 'CodeBlock', 'InlineCode'])

function isInCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1)
  for (;;) {
    if (CODE_NODES.has(node.name)) return true
    if (!node.parent) return false
    node = node.parent
  }
}

const FENCE_RE = /^---[ \t]*\r?$/

// The markdown grammar has no frontmatter concept — it reads the block as a
// setext heading — so the fence is located by line instead. Mirrors the rule
// in lib/frontmatter.ts: a leading --- line closed by a later --- line.
function frontmatterEndLine(state: EditorState): number {
  if (!FENCE_RE.test(state.doc.line(1).text)) return 0
  for (let n = 2; n <= state.doc.lines; n++) {
    if (FENCE_RE.test(state.doc.line(n).text)) return n
  }
  return 0 // unterminated: not frontmatter
}

/** True when pos sits in text no formatting command may rewrite. */
export function isProtected(state: EditorState, pos: number): boolean {
  const end = frontmatterEndLine(state)
  if (end > 0 && state.doc.lineAt(pos).number <= end) return true
  return isInCode(state, pos)
}
```

Note on `syntaxTree` vs `ensureSyntaxTree`: commands act on the selection, which is on screen by definition, and CodeMirror always parses the viewport plus a margin. So the cached tree is reliable here and no forced parse is needed in production code. Tests use `ensureSyntaxTree` only because a headless state has no viewport.

- [ ] **Step 5: Run to verify PASS**, then `npm test` and `npm run check` both clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/markdownCommands.ts frontend/src/lib/markdownCommands.test.ts frontend/package.json frontend/package-lock.json
git commit -m "feat: position guards for markdown formatting commands"
```

---

### Task 2: Line model and block commands

**Files:**
- Modify: `frontend/src/lib/markdownCommands.ts`, `frontend/src/lib/markdownCommands.test.ts`

**Interfaces:**
- Consumes: `isProtected` from Task 1.
- Produces (Task 4 wires these by name): `toggleHeading(level: number): StateCommand` where level 1–6 sets a heading and 0 removes any heading; `toggleBulletList: StateCommand`; `toggleOrderedList: StateCommand`; `toggleBlockquote: StateCommand`.

- [ ] **Step 1: Write the failing tests** (append to `markdownCommands.test.ts`)

```ts
import { EditorSelection, type StateCommand } from '@codemirror/state'
import {
  toggleHeading,
  toggleBulletList,
  toggleOrderedList,
  toggleBlockquote,
} from './markdownCommands'

function run(cmd: StateCommand, doc: string, from = 0, to = from): string {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: [markdown()],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  let next = state
  cmd({ state, dispatch: (tr) => (next = tr.state) })
  return next.doc.toString()
}

describe('toggleHeading', () => {
  it('makes the cursor line a heading', () => {
    expect(run(toggleHeading(2), 'Some line', 2)).toBe('## Some line')
  })

  it('removes the heading when the line already has that level', () => {
    expect(run(toggleHeading(2), '## Some line', 4)).toBe('Some line')
  })

  it('replaces a different level instead of stacking markers', () => {
    expect(run(toggleHeading(2), '### Some line', 5)).toBe('## Some line')
  })

  it('replaces a list marker rather than combining the two', () => {
    expect(run(toggleHeading(1), '- an item', 3)).toBe('# an item')
  })

  it('level 0 removes any heading', () => {
    expect(run(toggleHeading(0), '#### Deep', 6)).toBe('Deep')
  })

  it('applies to every line of a multi-line selection', () => {
    const doc = 'one\ntwo'
    expect(run(toggleHeading(1), doc, 0, doc.length)).toBe('# one\n# two')
  })

  it('removes only when every selected line already has that level', () => {
    const doc = '# one\n# two'
    expect(run(toggleHeading(1), doc, 0, doc.length)).toBe('one\ntwo')
  })

  it('applies to all when the selection is mixed', () => {
    const doc = '# one\ntwo'
    expect(run(toggleHeading(1), doc, 0, doc.length)).toBe('# one\n# two')
  })

  it('refuses to touch a fenced code block', () => {
    const doc = '```\ncode line\n```'
    expect(run(toggleHeading(1), doc, doc.indexOf('code'))).toBe(doc)
  })

  it('refuses to touch frontmatter', () => {
    const doc = '---\nbibliography: refs.bib\n---\n# T'
    expect(run(toggleHeading(1), doc, doc.indexOf('bibliography'))).toBe(doc)
  })
})

describe('list and quote commands', () => {
  it('makes selected lines a bulleted list', () => {
    const doc = 'one\ntwo'
    expect(run(toggleBulletList, doc, 0, doc.length)).toBe('- one\n- two')
  })

  it('removes bullets when every selected line has one', () => {
    const doc = '- one\n- two'
    expect(run(toggleBulletList, doc, 0, doc.length)).toBe('one\ntwo')
  })

  it('numbers an ordered list sequentially', () => {
    const doc = 'one\ntwo\nthree'
    expect(run(toggleOrderedList, doc, 0, doc.length)).toBe('1. one\n2. two\n3. three')
  })

  it('converts bullets to numbers', () => {
    const doc = '- one\n- two'
    expect(run(toggleOrderedList, doc, 0, doc.length)).toBe('1. one\n2. two')
  })

  it('preserves indentation', () => {
    expect(run(toggleBulletList, '    indented', 6)).toBe('    - indented')
  })

  it('toggles a blockquote', () => {
    expect(run(toggleBlockquote, 'quoted', 2)).toBe('> quoted')
    expect(run(toggleBlockquote, '> quoted', 4)).toBe('quoted')
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — the new commands do not exist yet.

- [ ] **Step 3: Implement** (append to `markdownCommands.ts`)

```ts
import { EditorSelection, type ChangeSpec, type StateCommand } from '@codemirror/state'

type BlockKind = 'heading' | 'bullet' | 'ordered' | 'quote' | 'none'

interface ParsedLine {
  indent: string
  kind: BlockKind
  level: number // heading level; 0 otherwise
  content: string
}

const LINE_RE = /^([ \t]*)(?:(#{1,6})[ \t]+|([-*+])[ \t]+|(\d+)[.)][ \t]+|(>)[ \t]?)?(.*)$/

function parseLine(text: string): ParsedLine {
  // LINE_RE always matches: every group after the indent is optional.
  const m = LINE_RE.exec(text) as RegExpExecArray
  const [, indent, hashes, bullet, ordered, quote, content] = m
  if (hashes) return { indent, kind: 'heading', level: hashes.length, content }
  if (bullet) return { indent, kind: 'bullet', level: 0, content }
  if (ordered) return { indent, kind: 'ordered', level: 0, content }
  if (quote) return { indent, kind: 'quote', level: 0, content }
  return { indent, kind: 'none', level: 0, content }
}

function renderLine(p: ParsedLine, ordinal: number): string {
  switch (p.kind) {
    case 'heading':
      return `${p.indent}${'#'.repeat(p.level)} ${p.content}`
    case 'bullet':
      return `${p.indent}- ${p.content}`
    case 'ordered':
      return `${p.indent}${ordinal}. ${p.content}`
    case 'quote':
      return `${p.indent}> ${p.content}`
    default:
      return `${p.indent}${p.content}`
  }
}

/**
 * Builds a line-wise command. `has` reports whether a line already carries the
 * format; when every target line does, `off` is applied to all of them,
 * otherwise `on` is. Deciding once for the whole selection — rather than per
 * line — is what makes a mixed selection resolve toward the requested format.
 */
function blockCommand(
  has: (p: ParsedLine) => boolean,
  on: (p: ParsedLine) => ParsedLine,
  off: (p: ParsedLine) => ParsedLine,
): StateCommand {
  return ({ state, dispatch }) => {
    const lines: number[] = []
    const seen = new Set<number>()
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number
      const last = state.doc.lineAt(range.to).number
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue
        seen.add(n)
        if (isProtected(state, state.doc.line(n).from)) continue
        lines.push(n)
      }
    }
    if (lines.length === 0) return false

    const parsed = lines.map((n) => parseLine(state.doc.line(n).text))
    const allHave = parsed.every(has)
    const changes: ChangeSpec[] = []
    let ordinal = 0
    lines.forEach((n, i) => {
      const next = allHave ? off(parsed[i]) : on(parsed[i])
      ordinal++
      const text = renderLine(next, ordinal)
      const line = state.doc.line(n)
      if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text })
    })
    if (changes.length === 0) return false

    // One transaction: one undo step. Selection maps through the changes.
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'format' }))
    return true
  }
}

const clear = (p: ParsedLine): ParsedLine => ({ ...p, kind: 'none', level: 0 })

export function toggleHeading(level: number): StateCommand {
  if (level === 0) {
    return blockCommand(
      (p) => p.kind !== 'heading',
      clear,
      clear,
    )
  }
  return blockCommand(
    (p) => p.kind === 'heading' && p.level === level,
    (p) => ({ ...p, kind: 'heading', level }),
    clear,
  )
}

export const toggleBulletList = blockCommand(
  (p) => p.kind === 'bullet',
  (p) => ({ ...p, kind: 'bullet', level: 0 }),
  clear,
)

export const toggleOrderedList = blockCommand(
  (p) => p.kind === 'ordered',
  (p) => ({ ...p, kind: 'ordered', level: 0 }),
  clear,
)

export const toggleBlockquote = blockCommand(
  (p) => p.kind === 'quote',
  (p) => ({ ...p, kind: 'quote', level: 0 }),
  clear,
)
```

`toggleHeading(0)` is expressed as "has = not a heading", so a line that *is* a heading fails the `every` check and takes the `on` branch — which also clears. Both branches clear, so the command reduces to "remove any heading" while reusing one factory.

- [ ] **Step 4: Run to verify PASS**, then full `npm test` and `npm run check`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/markdownCommands.ts frontend/src/lib/markdownCommands.test.ts
git commit -m "feat: block formatting commands for headings, lists, and quotes"
```

---

### Task 3: Inline commands

**Files:**
- Modify: `frontend/src/lib/markdownCommands.ts`, `frontend/src/lib/markdownCommands.test.ts`

**Interfaces:**
- Consumes: `isProtected` from Task 1.
- Produces (Task 4 wires these by name): `toggleBold`, `toggleItalic`, `toggleInlineCode`, `toggleStrikethrough` — all `StateCommand`.

- [ ] **Step 1: Write the failing tests** (append to `markdownCommands.test.ts`)

```ts
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  toggleStrikethrough,
} from './markdownCommands'

describe('inline commands', () => {
  it('wraps the selection in bold markers', () => {
    const doc = 'a word here'
    expect(run(toggleBold, doc, 2, 6)).toBe('a **word** here')
  })

  it('unwraps when the marks sit outside the selection', () => {
    const doc = 'a **word** here'
    expect(run(toggleBold, doc, 4, 8)).toBe('a word here')
  })

  it('unwraps when the marks are inside the selection', () => {
    const doc = 'a **word** here'
    expect(run(toggleBold, doc, 2, 10)).toBe('a word here')
  })

  it('inserts an empty pair at a bare cursor', () => {
    expect(run(toggleBold, 'ab', 1)).toBe('a****b')
  })

  it('adds italic to bold text rather than unwrapping the bold', () => {
    const doc = 'a **word** here'
    expect(run(toggleItalic, doc, 4, 8)).toBe('a ***word*** here')
  })

  it('handles inline code and strikethrough', () => {
    expect(run(toggleInlineCode, 'a word', 2, 6)).toBe('a `word`')
    expect(run(toggleStrikethrough, 'a word', 2, 6)).toBe('a ~~word~~')
  })

  it('refuses to format inside a fenced code block', () => {
    const doc = '```\ncode line\n```'
    const at = doc.indexOf('code')
    expect(run(toggleBold, doc, at, at + 4)).toBe(doc)
  })

  it('refuses to format inside frontmatter', () => {
    const doc = '---\nbibliography: refs.bib\n---\n'
    const at = doc.indexOf('refs')
    expect(run(toggleBold, doc, at, at + 4)).toBe(doc)
  })
})
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement** (append to `markdownCommands.ts`)

```ts
// A single-character mark doubled is a different mark: * is italic but ** is
// bold. Without this check, italicising bold text would strip one * per side
// and silently downgrade it.
function isDoubled(state: EditorState, from: number, to: number, mark: string): boolean {
  if (mark.length !== 1) return false
  return (
    state.sliceDoc(from - mark.length * 2, from - mark.length) === mark ||
    state.sliceDoc(to + mark.length, to + mark.length * 2) === mark
  )
}

function wrappedOutside(state: EditorState, from: number, to: number, mark: string): boolean {
  return (
    state.sliceDoc(from - mark.length, from) === mark &&
    state.sliceDoc(to, to + mark.length) === mark &&
    !isDoubled(state, from, to, mark)
  )
}

function wrappedInside(text: string, mark: string): boolean {
  return text.length >= mark.length * 2 && text.startsWith(mark) && text.endsWith(mark)
}

function toggleInline(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const ranges = state.selection.ranges
    if (ranges.every((r) => isProtected(state, r.from))) return false

    // Uniform toggle rule: remove only when every range already has the mark.
    const active = ranges.every(
      (r) =>
        !r.empty &&
        (wrappedOutside(state, r.from, r.to, mark) ||
          wrappedInside(state.sliceDoc(r.from, r.to), mark)),
    )

    const tr = state.changeByRange((range) => {
      if (isProtected(state, range.from)) return { range }

      if (active) {
        if (wrappedOutside(state, range.from, range.to, mark)) {
          const len = mark.length
          return {
            changes: [
              { from: range.from - len, to: range.from },
              { from: range.to, to: range.to + len },
            ],
            range: EditorSelection.range(range.from - len, range.to - len),
          }
        }
        const text = state.sliceDoc(range.from, range.to)
        const inner = text.slice(mark.length, text.length - mark.length)
        return {
          changes: { from: range.from, to: range.to, insert: inner },
          range: EditorSelection.range(range.from, range.from + inner.length),
        }
      }

      const text = state.sliceDoc(range.from, range.to)
      return {
        changes: { from: range.from, to: range.to, insert: mark + text + mark },
        range: text.length === 0
          ? EditorSelection.cursor(range.from + mark.length)
          : EditorSelection.range(range.from + mark.length, range.to + mark.length),
      }
    })

    dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'format' }))
    return true
  }
}

export const toggleBold = toggleInline('**')
export const toggleItalic = toggleInline('*')
export const toggleInlineCode = toggleInline('`')
export const toggleStrikethrough = toggleInline('~~')
```

- [ ] **Step 4: Run to verify PASS**, then full `npm test`, `npm run check`, and `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/markdownCommands.ts frontend/src/lib/markdownCommands.test.ts
git commit -m "feat: inline formatting commands for bold, italic, code, and strike"
```

---

### Task 4: Menu, editor passthrough, and wiring

**Files:**
- Modify: `frontend/src/Editor.svelte`, `frontend/src/App.svelte`, `menu.go`

**Interfaces:**
- Consumes: every command exported by Tasks 2 and 3.
- Produces: a working feature. `Editor.runCommand(cmd: StateCommand): void`. Go emits `menu:format` with a string payload; the payload vocabulary is `heading:0` … `heading:6`, `bullet`, `ordered`, `quote`, `bold`, `italic`, `code`, `strike`.

One event carrying a payload — rather than a dozen events — keeps `menu.go` and `App.svelte` in step with a single lookup table.

- [ ] **Step 1: Editor.svelte — add below `insertAtCursor`**

```ts
export function runCommand(cmd: StateCommand): void {
  cmd({ state: view.state, dispatch: (tr) => view.dispatch(tr) })
  view.focus()
}
```

Add the import at the top of the `<script>` block:

```ts
import type { StateCommand } from '@codemirror/state'
```

- [ ] **Step 2: menu.go — add a Format menu**

Insert immediately after `menu.AddRole(application.EditMenu)` and before `menu.AddRole(application.WindowMenu)`:

```go
	format := menu.AddSubmenu("Format")
	heading := format.AddSubmenu("Heading")
	headings := []struct {
		label string
		key   string
		arg   string
	}{
		{"Heading 1", "cmdorctrl+1", "heading:1"},
		{"Heading 2", "cmdorctrl+2", "heading:2"},
		{"Heading 3", "cmdorctrl+3", "heading:3"},
		{"Heading 4", "cmdorctrl+4", "heading:4"},
		{"Heading 5", "cmdorctrl+5", "heading:5"},
		{"Heading 6", "cmdorctrl+6", "heading:6"},
	}
	for _, h := range headings {
		arg := h.arg
		heading.Add(h.label).SetAccelerator(h.key).OnClick(func(*application.Context) {
			app.Event.Emit("menu:format", arg)
		})
	}
	heading.AddSeparator()
	heading.Add("Paragraph").SetAccelerator("cmdorctrl+0").OnClick(func(*application.Context) {
		app.Event.Emit("menu:format", "heading:0")
	})

	format.AddSeparator()
	inline := []struct {
		label string
		key   string
		arg   string
	}{
		{"Bold", "cmdorctrl+b", "bold"},
		{"Italic", "cmdorctrl+i", "italic"},
		{"Inline Code", "shift+cmdorctrl+k", "code"},
		{"Strikethrough", "shift+cmdorctrl+x", "strike"},
	}
	for _, it := range inline {
		arg := it.arg
		format.Add(it.label).SetAccelerator(it.key).OnClick(func(*application.Context) {
			app.Event.Emit("menu:format", arg)
		})
	}

	format.AddSeparator()
	format.Add("Bulleted List").SetAccelerator("shift+cmdorctrl+8").OnClick(func(*application.Context) {
		app.Event.Emit("menu:format", "bullet")
	})
	format.Add("Numbered List").SetAccelerator("shift+cmdorctrl+7").OnClick(func(*application.Context) {
		app.Event.Emit("menu:format", "ordered")
	})
	// Blockquote deliberately has no accelerator: the punctuation chords are
	// not worth guessing at, and the menu item is the discoverable route.
	format.Add("Blockquote").OnClick(func(*application.Context) {
		app.Event.Emit("menu:format", "quote")
	})
```

The `arg := h.arg` line inside each loop is load-bearing — without it every closure would capture the same loop variable.

- [ ] **Step 3: App.svelte — add the lookup table and handler**

Add to the imports:

```ts
import type { StateCommand } from '@codemirror/state'
import {
  toggleHeading,
  toggleBulletList,
  toggleOrderedList,
  toggleBlockquote,
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  toggleStrikethrough,
} from './lib/markdownCommands'
```

Add near the other functions:

```ts
const FORMAT_COMMANDS: Record<string, StateCommand> = {
  'heading:0': toggleHeading(0),
  'heading:1': toggleHeading(1),
  'heading:2': toggleHeading(2),
  'heading:3': toggleHeading(3),
  'heading:4': toggleHeading(4),
  'heading:5': toggleHeading(5),
  'heading:6': toggleHeading(6),
  bullet: toggleBulletList,
  ordered: toggleOrderedList,
  quote: toggleBlockquote,
  bold: toggleBold,
  italic: toggleItalic,
  code: toggleInlineCode,
  strike: toggleStrikethrough,
}

function applyFormat(name: string) {
  // Menu accelerators fire regardless of focus, so a guard is required:
  // without it, Cmd-B on the welcome screen would edit a hidden document.
  if (showWelcome) return
  const cmd = FORMAT_COMMANDS[name]
  if (cmd) editor.runCommand(cmd)
}
```

Register the listener alongside the others in `onMount`:

```ts
Events.On('menu:format', (ev: { data: unknown }) => {
  if (typeof ev.data === 'string') applyFormat(ev.data)
})
```

- [ ] **Step 4: Gates** — `cd frontend && npm test && npm run check && npm run build`; then at the repo root `gofmt -l menu.go` (must print nothing), `go test ./.`, `go build -o /dev/null .`, and finally `wails3 build`. Do NOT launch the GUI.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Editor.svelte frontend/src/App.svelte menu.go
git commit -m "feat: Format menu wired to the markdown formatting commands"
```

---

### Task 5: Manual verification document and docs

**Files:**
- Modify: `docs/visual-test.md`, `CLAUDE.md`

**Interfaces:** none new — this task packages manual verification.

- [ ] **Step 1: Add a section to `docs/visual-test.md`**, before the intentional-errors section, renumbering that section as before:

```markdown
## 10. Formatting commands

Put the cursor on this line and press ⌘2 — it becomes a Heading 2. Press ⌘2
again and it reverts. Press ⌘3 on it while it is a Heading 2 and the marker is
replaced, never stacked (`## ###` is a bug).

Select these three lines
and press ⌘⇧8 to bullet them,
then ⌘⇧7 to renumber them 1, 2, 3.

Select a word in this sentence and press ⌘B, then ⌘B again to remove it. With
the word still bold, press ⌘I — it must become bold *and* italic, not lose its
bold. ⌘Z once must undo the whole action, not one marker at a time.

These must refuse to change:

- Any line of the frontmatter at the top of this file.
- Any line inside the vega-lite block in section 6.
- The contents of an inline code span like `[@smith2020]`.

On the welcome screen (⌘N with no document open), ⌘B must do nothing at all.
```

- [ ] **Step 2: CLAUDE.md** — in the architecture section's frontend-pipeline bullet, add one sentence: formatting commands live in `lib/markdownCommands.ts` as pure CodeMirror `StateCommand`s, invoked from the Format menu via the `menu:format` event, guarded so they never rewrite fenced code or frontmatter.

- [ ] **Step 3: Gates + commit**

```bash
git add docs/visual-test.md CLAUDE.md
git commit -m "docs: formatting commands section in the visual test document"
```

---

### Task 6: Release preparation

**Gate: run only after the human has completed the manual verification in Task 5.**

- [ ] **Step 1: CHANGELOG.md** — add the formatting commands under `[Unreleased]` → `### Added`, describing the Format menu, the accelerators, and the guarantee that fenced code and frontmatter are never rewritten.
- [ ] **Step 2: ROADMAP.md** — tick the formatting-commands bullet in the v0.4 section.
- [ ] **Step 3: Commit** — `git commit -m "docs: record formatting commands in changelog and roadmap"`.

Note: the version bump, build-asset regeneration, and tag happen once *all* v0.4 items land, not with this feature alone.

## Self-Review

**Spec coverage.** Every settled decision maps to a task: toggle semantics → the uniform rule in Task 2's `blockCommand` and Task 3's `active` check, with tests for the same-level, different-level, and mixed-selection cases; shortcut ownership → Task 4's `menu.go` accelerators with no CodeMirror keymap, plus the `showWelcome` focus guard; UI surface → Task 4 adds a Format menu and no toolbar buttons. The three tree hazards from the spec are covered: fenced code and inline code by `isInCode`, frontmatter by `frontmatterEndLine`. Math and citations need no guard of their own — math sits in ordinary paragraphs where formatting is legitimate, and citations are only misread as links by the tree, which these commands never consult for link nodes.

**Placeholder scan.** No TBDs; every code step carries real code. The one deliberate omission — no accelerator for Blockquote — is stated as a decision with its reason, not left open.

**Type consistency.** `isProtected(state, pos)` is defined in Task 1 and called with that signature in Tasks 2 and 3. `StateCommand` is used consistently across Tasks 2, 3, and 4. The `menu:format` payload vocabulary in Task 4's Go table matches the `FORMAT_COMMANDS` keys exactly, including `heading:0` for Paragraph. `runCommand` is named identically in Editor.svelte and App.svelte.
