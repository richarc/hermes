# Insert → Code Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `Insert → Code Block` submenu that writes a fenced code block with a chosen language and leaves the cursor inside it, wrapping any selected text rather than deleting it.

**Architecture:** Three files, following the established menu wiring. `menu.go` gains a `Code Block` submenu whose items emit `menu:insert-code` carrying a language token; `Editor.svelte` gains one exported method that inserts the fence and places the selection inside it; `App.svelte` subscribes to the event and calls that method behind the same guards every other menu handler uses.

**Tech Stack:** Go (Wails v3 menus + event bus), Svelte 5, CodeMirror 6, Vitest + jsdom.

## Global Constraints

- The design document this implements is `docs/superpowers/specs/2026-08-09-insert-code-block-design.md`. Where this plan and that document disagree, the design wins.
- No accelerator on any item added here. An invented chord cannot be checked against every macOS binding — the same reasoning as Insert → Chart… and Blockquote.
- The language tokens written into the fence must be ones `loadGrammar` (`frontend/src/lib/codeHighlight.ts`) can resolve, or the inserted block silently renders without colour. All thirteen tokens in this plan were run through that lookup (`languages.find(l => l.name.toLowerCase() === token || l.alias.includes(token))`) and matched. MATLAB was checked and does **not** resolve, which is why it is absent.
- Never hand-edit `frontend/bindings/` — but nothing here changes a service API, so no regeneration is needed.
- Frontend tests: `cd frontend && npx vitest run <file>`. Go build check: `go test ./. && go build -o /dev/null .` (use `.`, not `./...`).

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/Editor.svelte` | Modify: add `insertCodeBlockAtCursor(language)` — the only place that knows how to place a cursor inside a freshly written fence |
| `frontend/src/Editor.test.ts` | Modify: pin the two cursor/selection behaviours that make the feature worth having |
| `frontend/src/App.svelte` | Modify: subscribe to `menu:insert-code`, guard it, route it to the editor |
| `frontend/src/App.test.ts` | Modify: pin that the event reaches the editor and is refused while the chart builder is open |
| `menu.go` | Modify: the `Code Block` submenu under `Insert`, emitting `menu:insert-code` |
| `CHANGELOG.md`, `ROADMAP.md` | Modify: record the feature and tick the v0.7 bullet |

---

### Task 1: The editor writes a fence and puts the cursor in it

**Files:**
- Modify: `frontend/src/Editor.svelte` (add an export next to `insertBlockAtCursor`, around line 183-189)
- Test: `frontend/src/Editor.test.ts` (add a `describe` block after the existing `Editor.insertBlockAtCursor` block, which ends at line 186)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `insertCodeBlockAtCursor(language: string): void` on the Editor component instance. `language` is the bare fence token (`'python'`, `'c++'`, …) or `''` for a fence with no language. Task 3 calls it.

- [ ] **Step 1: Add the method to the test file's `EditorApi` interface**

`Editor.test.ts` types the mounted component through a hand-written interface (lines 16-25) because Svelte 5's `mount` returns an opaque value. Add the new method to it:

```ts
interface EditorApi {
  setContent(text: string, cursor?: 'start' | 'end'): void
  insertAtCursor(text: string): void
  insertBlockAtCursor(text: string): void
  insertCodeBlockAtCursor(language: string): void
  runCommand(cmd: Command): void
  lineCount(): number
  topVisibleLine(): number
  enclosingChartBlock(): ChartBlock | null
  replaceRange(from: number, to: number, text: string): void
}
```

- [ ] **Step 2: Write the failing tests**

Append to `frontend/src/Editor.test.ts`, after the `describe('Editor.insertBlockAtCursor', ...)` block:

```ts
describe('Editor.insertCodeBlockAtCursor', () => {
  // The whole point of the feature. insertBlockAtCursor leaves the cursor
  // *after* what it inserted, which would strand the author below a fence
  // they have to arrow back into — barely better than typing the backticks.
  it('leaves the cursor on the empty line between the fences, so typing goes into the block', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('') // cursor defaults to the start
    flushSync()

    editor.insertCodeBlockAtCursor('python')
    flushSync()
    // Typing at wherever the cursor was left is the honest test of placement.
    editor.insertAtCursor('print(1)')
    flushSync()

    expect(text()).toBe('```python\nprint(1)\n```\n')
    cleanup()
  })

  it('writes a bare fence when given no language', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('')
    flushSync()

    editor.insertCodeBlockAtCursor('')
    flushSync()

    expect(text()).toBe('```\n\n```\n')
    cleanup()
  })

  // insertBlockAtCursor is built on replaceSelection, which DELETES the
  // selection and puts the block in its place. For a code block the
  // obviously-correct behaviour is the opposite: an author who selected three
  // lines and reached for this menu means "wrap these".
  it('wraps a selection in the fence rather than destroying it', () => {
    const { editor, target, text, cleanup } = mountEditor()
    editor.setContent('alpha\nbeta\n')
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 0, head: 'alpha\nbeta'.length } })
    flushSync()

    editor.insertCodeBlockAtCursor('shell')
    flushSync()

    expect(text()).toBe('```shell\nalpha\nbeta\n```\n\n')
    cleanup()
  })

  it('leaves the wrapped text selected, so it can be retyped in one keystroke', () => {
    const { editor, target, text, cleanup } = mountEditor()
    editor.setContent('alpha\n')
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 0, head: 'alpha'.length } })
    flushSync()

    editor.insertCodeBlockAtCursor('shell')
    flushSync()
    // Replacing the selection proves it covers exactly the wrapped text and
    // neither fence line.
    editor.insertAtCursor('ls')
    flushSync()

    expect(text()).toBe('```shell\nls\n```\n\n')
    cleanup()
  })

  // Same hazard insertBlockAtCursor exists to avoid: written at a column
  // other than 0 it is not a fence at all, and markdown renders its contents
  // as prose.
  it('starts the fence on a fresh line when the cursor is mid-line', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('Some prose here.', 'end')
    flushSync()

    editor.insertCodeBlockAtCursor('go')
    flushSync()

    const doc = text()
    expect(doc).toMatch(/(^|\n)```go/)
    expect(doc.split('\n')[0]).toBe('Some prose here.')
    cleanup()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/Editor.test.ts`
Expected: FAIL — `editor.insertCodeBlockAtCursor is not a function`.

- [ ] **Step 4: Implement the method**

In `frontend/src/Editor.svelte`, immediately after `insertBlockAtCursor` (which ends at line 189), add:

```ts
  /**
   * Writes a fenced code block and leaves the cursor *inside* it.
   *
   * insertBlockAtCursor leaves the cursor after the text it inserted, which
   * for a fence strands the author below it needing two arrow keys to get in
   * — barely better than typing the backticks. This one places the selection
   * on the body line instead, which is the part that makes the menu route
   * worth having.
   *
   * A selection is wrapped, not replaced. replaceSelection (what
   * insertBlockAtCursor uses) would delete it, and an author who selected
   * three lines and reached for this menu means "wrap these". The selected
   * text is reused verbatim — no trimming, no re-indentation — and stays
   * selected afterwards.
   */
  export function insertCodeBlockAtCursor(language: string): void {
    const { from, to } = view.state.selection.main
    const line = view.state.doc.lineAt(from)
    // Same fresh-line guarantee, and the same reason, as insertBlockAtCursor:
    // at a column other than 0 this is not a fence at all.
    const prefix = from === line.from ? '' : '\n\n'
    const body = view.state.doc.sliceString(from, to)
    const open = '```' + language + '\n'
    // The trailing newline keeps whatever followed the insertion point off
    // the closing fence's line, which would otherwise break the fence.
    const text = prefix + open + body + '\n```\n'
    const bodyFrom = from + prefix.length + open.length
    view.dispatch({
      changes: { from, to, insert: text },
      // Collapsed onto the empty line when there was no selection; spanning
      // the wrapped text when there was.
      selection: { anchor: bodyFrom, head: bodyFrom + body.length },
    })
    view.focus()
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/Editor.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Editor.svelte frontend/src/Editor.test.ts
git commit -m "feat: insert a code fence with the cursor inside it"
```

---

### Task 2: The menu offers the languages

**Files:**
- Modify: `menu.go:94-103` (the `insert` submenu block)

**Interfaces:**
- Consumes: nothing.
- Produces: the `menu:insert-code` event, payload a `string` — the bare fence token, or `""` for Plain text. Task 3 subscribes to it.

`menu.go` stays untested: it has no test file, AppKit menu construction is not exercisable headlessly, and the tokens' resolvability was verified once (see Global Constraints) rather than pinned by a test that would only restate the list. So this task has no red/green cycle — it compiles or it does not.

- [ ] **Step 1: Add the submenu**

In `menu.go`, after the `insert.Add("Chart…")` block (line 101-103), add:

```go
	// A submenu rather than a dialog: a code fence is a delimiter and a
	// language name, and the only part carrying value is choosing the
	// language — which a submenu does natively. Curated rather than the ~150
	// language-data knows about, which would be unusable as a menu.
	//
	// Every token below was checked against loadGrammar's lookup (by name or
	// alias) and resolves; one that does not would insert a block that
	// silently never colours. MATLAB was considered and dropped for exactly
	// that reason — no grammar ships for it.
	codeBlock := insert.AddSubmenu("Code Block")
	codeLanguages := []struct {
		label string
		token string
	}{
		{"Python", "python"},
		{"R", "r"},
		{"Julia", "julia"},
		{"Fortran", "fortran"},
		{"C++", "c++"},
		{"JavaScript", "javascript"},
		{"Go", "go"},
		{"Rust", "rust"},
		{"Shell", "shell"},
		{"SQL", "sql"},
		{"JSON", "json"},
		{"YAML", "yaml"},
		{"LaTeX", "latex"},
	}
	for _, l := range codeLanguages {
		token := l.token
		codeBlock.Add(l.label).OnClick(func(*application.Context) {
			app.Event.Emit("menu:insert-code", token)
		})
	}
	// Separated for the same reason Paragraph is separated from the headings
	// below: it is the "no language" option, not another language.
	codeBlock.AddSeparator()
	codeBlock.Add("Plain text").OnClick(func(*application.Context) {
		app.Event.Emit("menu:insert-code", "")
	})
```

- [ ] **Step 2: Verify it builds and the existing Go tests still pass**

Run: `go test ./. && go build -o /dev/null .`
Expected: `ok  	hermes` then a clean build with no output.

- [ ] **Step 3: Commit**

```bash
git add menu.go
git commit -m "feat: an Insert → Code Block submenu of curated languages"
```

---

### Task 3: The app routes the event to the editor

**Files:**
- Modify: `frontend/src/App.svelte` (a handler near `applyFold`, which ends at line 296; a subscription in `onMount` near line 517)
- Test: `frontend/src/App.test.ts` (a new `describe` block; add it after the `chart builder` describe block)

**Interfaces:**
- Consumes: `editor.insertCodeBlockAtCursor(language: string): void` from Task 1; the `menu:insert-code` event with a `string` payload from Task 2.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/App.test.ts`, after the `describe('chart builder', ...)` block. Note it reuses the file's existing helpers: `mountApp`, `listeners`, `recents`, and `DocumentService.OpenPath`.

```ts
describe('insert code block', () => {
  async function openDoc(content: string) {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({ path: '/tmp/paper.md', content })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('Results'))
    return target
  }

  it('writes a fence carrying the language the menu named', async () => {
    const target = await openDoc('# Results\n\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!

    listeners['menu:insert-code']({ data: 'python' })
    flushSync()

    expect(view.state.doc.toString()).toContain('```python\n')
  })

  it('writes a bare fence for the Plain text item', async () => {
    const target = await openDoc('# Results\n\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!

    listeners['menu:insert-code']({ data: '' })
    flushSync()

    expect(view.state.doc.toString()).toContain('```\n\n```')
  })

  // Menu events arrive from AppKit through Go's event bus and never touch the
  // DOM, so a modal cannot intercept them — the same reason applyFormat and
  // applyFold carry this guard.
  it('is refused while the chart builder is open', async () => {
    const target = await openDoc('# Results\n\nJust prose.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    listeners['menu:insert-chart']({ data: null })
    flushSync()
    expect(target.querySelector('.chart-builder')).not.toBeNull()
    const before = view.state.doc.toString()

    listeners['menu:insert-code']({ data: 'python' })
    flushSync()

    expect(view.state.doc.toString()).toBe(before)
  })

  it('does nothing from the welcome screen', async () => {
    recents.current = ['/tmp/paper.md']
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const before = view.state.doc.toString()

    listeners['menu:insert-code']({ data: 'python' })
    flushSync()

    expect(view.state.doc.toString()).toBe(before)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/App.test.ts`
Expected: FAIL — `listeners['menu:insert-code'] is not a function`, because nothing subscribes to the event yet.

- [ ] **Step 3: Add the handler**

In `frontend/src/App.svelte`, after `applyFold` (which ends at line 296), add:

```ts
  function insertCodeBlock(language: string) {
    // Same guard as applyFormat and applyFold: menu items fire regardless of
    // focus, so without it this would write into the hidden document behind
    // the welcome pane — or into the one behind the chart builder, which has
    // no way to intercept an event arriving through Go's bus.
    if (showWelcome || chartOpen) return
    editor.insertCodeBlockAtCursor(language)
  }
```

- [ ] **Step 4: Subscribe to the event**

In `onMount`, after the `menu:insert-chart` subscription (line 517), add:

```ts
    Events.On('menu:insert-code', (ev: { data: unknown }) => {
      // '' is the Plain text item, and a legitimate payload — a bare fence.
      if (typeof ev.data === 'string') insertCodeBlock(ev.data)
    })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/App.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Run the whole frontend suite and the type check**

Run: `cd frontend && npm test && npm run check`
Expected: all test files pass; `svelte-check` reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.svelte frontend/src/App.test.ts
git commit -m "feat: route menu:insert-code to the editor, guarded like its neighbours"
```

---

### Task 4: Record it

**Files:**
- Modify: `CHANGELOG.md` (the `## [Unreleased]` / `### Added` list)
- Modify: `ROADMAP.md:212-222` (the unticked Insert-menu-route bullet)

**Interfaces:**
- Consumes: the finished feature. Produces: nothing.

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` → `### Added` in `CHANGELOG.md`, after the syntax-highlighting bullet:

```markdown
- Insert → Code Block writes the fence for you, with a submenu of fourteen
  languages — so the backticks and the language tag are one menu choice rather
  than something to remember, and a misspelt tag can no longer leave a block
  silently uncoloured. The cursor lands inside the block, ready to type; text
  selected beforehand is wrapped in the fence rather than replaced by it.
```

- [ ] **Step 2: Tick the roadmap bullet**

In `ROADMAP.md`, change the `- [ ] A simple Insert menu route to a code block…` bullet (line 212) to `- [x]` and rewrite its body to describe what shipped rather than what was proposed — the question it poses ("Whether it needs a *builder* … is worth questioning") has been answered, so it should read as a record, not an open question:

```markdown
- [x] A simple Insert menu route to a code block. `Insert → Code Block` is a
      submenu of fourteen curated languages, each emitting `menu:insert-code`
      with the fence token it writes; `App.svelte` handles it behind the same
      welcome-pane and chart-builder guards as every other menu action. Not a
      builder — the chart builder exists because a Vega-Lite spec is genuinely
      hard to hand-write, whereas a code fence is a delimiter and a language
      name, and the only part carrying value is choosing the language. Curated
      rather than all ~150 `language-data` knows, which would need a filter
      field, which is the dialog this deliberately avoided; every token was
      checked to resolve, so no item can offer a language that renders plain.
      The cursor lands inside the fence rather than after it — the difference
      between this and typing the backticks — and a selection is wrapped, not
      destroyed. No accelerator.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md ROADMAP.md
git commit -m "docs: record the Insert → Code Block route"
```

---

## Out of scope, deliberately

`Insert → Chart…` destroys a selection today, for the same reason this design had to avoid: `commitChart`'s insert branch routes through `insertBlockAtCursor`, which is built on `replaceSelection`. Select a paragraph, insert a chart, and the paragraph is gone with no prompt. That is a pre-existing bug in another feature; the design records it rather than fixing it in passing. Do not change `commitChart` while implementing this plan.

## Manual check (after Task 4)

Run the app (`wails3 task run`) and walk the design's list:

1. Insert → Code Block → Python with the cursor in prose: a fence appears on its own line, the cursor is inside it, typing goes into the block.
2. The block colours as Python once typed into — both panes.
3. Select two lines of prose and insert a Shell block: the lines are inside the fence, not deleted.
4. Insert → Code Block → Plain text: a bare fence, no language, no colour.
5. With the chart builder open, the item does nothing.
