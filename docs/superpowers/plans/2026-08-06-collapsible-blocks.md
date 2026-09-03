# Collapsible Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CodeMirror's existing block folding discoverable from the View menu, add a fold-all limited to code blocks, and fix the folded placeholder in dark mode.

**Architecture:** Folding already works — this adds one custom `StateCommand` for folding only fenced code, four View-menu items that route through the established `menu:*` event path, and `var()` theme rules for the folded placeholder.

**Tech Stack:** Svelte 5 (runes), TypeScript, CodeMirror 6, Vitest, jsdom, Go 1.25 + Wails v3.

**Spec:** [docs/superpowers/specs/2026-08-06-collapsible-blocks-design.md](../specs/2026-08-06-collapsible-blocks-design.md)

## Global Constraints

- Frontend work is in `frontend/`; `menu.go` and `CLAUDE.md` are at the repo ROOT. **Use an explicit `cd` in EVERY bash call** — the working directory does not reliably persist.
- Svelte 5 runes only. No Svelte 4 store syntax.
- Verification: `npx vitest run`, `npm run check` (must report `0 ERRORS`), `npm run build` from `frontend/`. Go: `gofmt -l . | grep -v '^build/'` (must print nothing), `go vet ./.`, `go test ./.`, `go build -o /dev/null .` from the repo root — note `./.`, not `./...`.
- Baseline before starting: **199 frontend tests across 16 files**, Go tests passing.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **jsdom has no CSS cascade and no layout.** Never assert a computed colour. Theme changes are asserted structurally — that the generated stylesheet references the right variables.
- **Do not add an accelerator to Fold All Code Blocks or Unfold All.** An invented chord cannot be verified against every macOS binding; `⌘⌥[` / `⌘⌥]` are safe to display only because CodeMirror owns them and the menu is reflecting that.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/foldCommands.ts` (create) | `foldAllCodeBlocks` — folds fenced code only |
| `src/lib/foldCommands.test.ts` (create) | Headless coverage, no DOM |
| `src/Editor.svelte` (modify) | Widen `runCommand` to `Command`; theme `.cm-foldPlaceholder` |
| `src/Editor.test.ts` (modify) | Assert the placeholder is themed from variables |
| `src/App.svelte` (modify) | `FOLD_COMMANDS`, `applyFold`, `menu:fold` listener |
| `menu.go` (modify) | Four View-menu items |
| `CLAUDE.md` (modify) | Widen the keymap warning to `foldKeymap` |

---

## Task 1: Fold all code blocks

**Files:**
- Create: `frontend/src/lib/foldCommands.ts`, `frontend/src/lib/foldCommands.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `foldAllCodeBlocks: StateCommand`. Task 3 puts it in `FOLD_COMMANDS`.

**Why this is not CodeMirror's `foldAll`.** `foldAll` folds everything foldable, including headings — which collapses a paper to an outline. That is a different feature. The test asserting the heading and table stay unfolded is what separates them, and what would catch a future refactor reaching for `foldAll` as a simplification.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/foldCommands.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { EditorState, type Transaction } from '@codemirror/state'
import { codeFolding, foldedRanges, foldGutter } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { foldAllCodeBlocks } from './foldCommands'

const DOC = `# Results

Prose here.

\`\`\`vega-lite
{
  "mark": "bar"
}
\`\`\`

More prose.

\`\`\`js
const x = 1
\`\`\`

| a | b |
|---|---|
| 1 | 2 |
`

function makeState(doc = DOC) {
  // codeFolding() supplies the fold state the effects land in; markdown()
  // supplies the syntax tree the command walks. No DOM needed for either.
  return EditorState.create({ doc, extensions: [codeFolding(), foldGutter(), markdown()] })
}

/** Runs the command and returns the resulting state. */
function run(state: EditorState): { state: EditorState; handled: boolean } {
  let tr: Transaction | null = null
  const handled = foldAllCodeBlocks({ state, dispatch: (t) => (tr = t) })
  return { state: tr ? (tr as Transaction).state : state, handled }
}

/** The 1-based first line of every folded range. */
function foldedStartLines(state: EditorState): number[] {
  const lines: number[] = []
  foldedRanges(state).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number)
  })
  return lines.sort((a, b) => a - b)
}

describe('foldAllCodeBlocks', () => {
  it('folds every fenced code block', () => {
    const { state, handled } = run(makeState())
    expect(handled).toBe(true)
    // Fold ranges start at the END of the fence's opening line, so both
    // folds begin on the line carrying ``` — lines 5 and 14.
    expect(foldedStartLines(state)).toEqual([5, 14])
  })

  it('leaves headings and tables alone', () => {
    // The distinction from CodeMirror's foldAll, which folds those too.
    const { state } = run(makeState())
    const folded = foldedStartLines(state)
    expect(folded).not.toContain(1) // "# Results"
    expect(folded).not.toContain(17) // the table
  })

  it('is a no-op the second time', () => {
    const first = run(makeState())
    const second = run(first.state)
    expect(second.handled).toBe(false)
    expect(foldedStartLines(second.state)).toEqual([5, 14])
  })

  it('does nothing in a document with no code blocks', () => {
    const { state, handled } = run(makeState('# Title\n\nJust prose.\n'))
    expect(handled).toBe(false)
    expect(foldedStartLines(state)).toEqual([])
  })

  it('folds in a single transaction, so one undo restores everything', () => {
    let count = 0
    const state = makeState()
    foldAllCodeBlocks({ state, dispatch: () => count++ })
    expect(count).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd <repo>/frontend && npx vitest run src/lib/foldCommands.test.ts`
Expected: FAIL — cannot resolve `./foldCommands`.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/foldCommands.ts`:

```ts
import { syntaxTree, foldable, foldEffect, foldedRanges } from '@codemirror/language'
import type { StateCommand, StateEffect } from '@codemirror/state'

/**
 * Folds every fenced code block, and nothing else.
 *
 * Deliberately not CodeMirror's `foldAll`, which folds every foldable block
 * including headings — collapsing a paper into an outline. That is a different
 * feature; this one hides the long blocks a reader skips past.
 *
 * One transaction, so a single undo restores the whole document's view.
 */
export const foldAllCodeBlocks: StateCommand = ({ state, dispatch }) => {
  const already = foldedRanges(state)
  // Annotated rather than left to inference: an empty array literal infers
  // any[], which svelte-check rejects.
  const effects: StateEffect<unknown>[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const line = state.doc.lineAt(node.from)
      const range = foldable(state, line.from, line.to)
      if (!range) return
      // Skip blocks already folded, so running twice is a no-op rather than
      // stacking duplicate ranges.
      let isFolded = false
      already.between(range.from, range.to, (from, to) => {
        if (from === range.from && to === range.to) isFolded = true
      })
      if (!isFolded) effects.push(foldEffect.of(range))
    },
  })

  if (effects.length === 0) return false
  dispatch(state.update({ effects }))
  return true
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd <repo>/frontend && npx vitest run src/lib/foldCommands.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `cd <repo>/frontend && npx vitest run && npm run check`
Expected: 204 tests across 17 files; `0 ERRORS`.

```bash
cd <repo>/frontend
git add src/lib/foldCommands.ts src/lib/foldCommands.test.ts
git commit -m "$(cat <<'EOF'
feat: add a fold-all limited to fenced code blocks

Deliberately not CodeMirror's foldAll, which folds headings too and
collapses a paper into an outline. The test asserting the heading and table
stay unfolded is what separates the two, and what would catch a future
refactor reaching for foldAll as a simplification.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Theme the folded placeholder, and widen `runCommand`

**Files:**
- Modify: `frontend/src/Editor.svelte`, `frontend/src/Editor.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `runCommand(cmd: Command): void` — widened from `StateCommand`. Task 3 passes it both kinds.

**Two changes, one file, both prerequisites for Task 3.**

`.cm-foldPlaceholder` — the pill shown where a folded block was — is hardcoded in CodeMirror's base theme as `#eee` background, `#ddd` border, `#888` text. `hermesTheme` does not override it, so a folded block in dark mode shows a light-grey pill against `#1f1f1f`. Same defect class as the search panel fixed in v0.5, same cause.

And all four CodeMirror fold commands are typed `Command` — `(view: EditorView) => boolean` — while `runCommand` currently accepts `StateCommand`. Widening to `Command` serves both: `StateCommand` is assignable to `Command` by parameter contravariance, and a `StateCommand` invoked with a view works at runtime. Both were verified during planning — `toggleBold(view)` produces `**hello**`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/Editor.test.ts`:

```ts
describe('Editor folding', () => {
  it('themes the folded placeholder from the palette', () => {
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    // CodeMirror's base theme hardcodes #eee/#ddd/#888 here, which is a light
    // pill on a dark page. Ours must come from the palette instead.
    expect(css).toMatch(/\.cm-foldPlaceholder[^}]*var\(--/)

    cleanup()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd <repo>/frontend && npx vitest run src/Editor.test.ts`
Expected: FAIL — no `.cm-foldPlaceholder` rule in the generated stylesheet.

- [ ] **Step 3: Theme the placeholder**

In `frontend/src/Editor.svelte`, add to the `hermesTheme` object, alongside the
other rules:

```ts
    // CodeMirror's base theme hardcodes this pill as #eee on #ddd with #888
    // text — a light chip on a dark page. Same class of gap as the search
    // panel: a base rule the theme has to override to follow the palette.
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      color: 'var(--muted)',
    },
```

- [ ] **Step 4: Widen `runCommand`**

In `frontend/src/Editor.svelte`, change the import of `StateCommand` to also
bring in `Command`:

```ts
  import type { Command } from '@codemirror/view'
```

and replace `runCommand`:

```ts
  /**
   * Runs an editor command. Typed `Command` rather than `StateCommand` because
   * CodeMirror's fold commands need the view — and a `StateCommand` works when
   * handed a view too, so this one signature serves both kinds.
   */
  export function runCommand(cmd: Command): void {
    cmd(view)
    view.focus()
  }
```

The existing `StateCommand` callers in `App.svelte` need no change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd <repo>/frontend && npx vitest run && npm run check`
Expected: 205 tests across 17 files; `0 ERRORS`. The existing formatting-command
tests must still pass — they are the proof that widening the signature did not
break the `StateCommand` path.

- [ ] **Step 6: Commit**

```bash
cd <repo>/frontend
git add src/Editor.svelte src/Editor.test.ts
git commit -m "$(cat <<'EOF'
fix: theme the folded placeholder, and widen runCommand to Command

CodeMirror hardcodes .cm-foldPlaceholder as #eee/#ddd/#888, so a folded
block showed a light pill against the dark background — the same class of
gap as the search panel, and a base rule the theme has to override.

runCommand widens from StateCommand to Command because all four fold
commands need the view. StateCommand is assignable to Command by parameter
contravariance and works when handed a view, so one signature serves both
and the existing formatting commands are untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire the four commands to a menu

**Files:**
- Modify: `frontend/src/App.svelte`, `frontend/src/App.test.ts`, `menu.go`, `CLAUDE.md`

**Interfaces:**
- Consumes: `foldAllCodeBlocks` from Task 1; the widened `runCommand` from Task 2.
- Produces: the finished feature.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/App.test.ts`. The `vi.hoisted` harness at the top of
that file already captures event listeners in `listeners` and exposes the
mocked `DocumentService`.

The templated document a first launch produces is pure frontmatter with no
fenced code, so these tests open a document that has one, through the same
`menu:open-recent` path the app really uses.

```ts
describe('fold menu', () => {
  const WITH_CODE = '# Results\n\n```js\nconst x = 1\nconst y = 2\n```\n'

  async function mountWithCodeBlock() {
    recents.current = ['/tmp/paper.md']
    DocumentService.OpenPath.mockResolvedValueOnce({
      path: '/tmp/paper.md',
      content: WITH_CODE,
    })
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    listeners['menu:open-recent']({ data: '/tmp/paper.md' })
    await vi.waitFor(() => expect(target.textContent).toContain('const x'))
    return target
  }

  it('folds every code block when the menu asks', async () => {
    const target = await mountWithCodeBlock()

    listeners['menu:fold']({ data: 'fold-all-code' })
    flushSync()

    // The placeholder pill is what replaces the hidden lines.
    await vi.waitFor(() =>
      expect(target.querySelector('.cm-foldPlaceholder')).not.toBeNull(),
    )
  })

  it('ignores an unknown command name', async () => {
    const target = await mountWithCodeBlock()

    // Must not throw — the same tolerance menu:format already has.
    listeners['menu:fold']({ data: 'not-a-command' })
    flushSync()

    expect(target.querySelector('.cm-foldPlaceholder')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd <repo>/frontend && npx vitest run src/App.test.ts`
Expected: FAIL — `listeners['menu:fold']` is `undefined`; nothing subscribes yet.

- [ ] **Step 3: Add the command map and handler**

In `frontend/src/App.svelte`, add to the imports:

```ts
  import { foldCode, unfoldCode, unfoldAll } from '@codemirror/language'
  import type { Command } from '@codemirror/view'
  import { foldAllCodeBlocks } from './lib/foldCommands'
```

Add the map and handler beside `FORMAT_COMMANDS` and `applyFormat`:

```ts
  const FOLD_COMMANDS: Record<string, Command> = {
    'fold-block': foldCode,
    'unfold-block': unfoldCode,
    'fold-all-code': foldAllCodeBlocks,
    'unfold-all': unfoldAll,
  }

  function applyFold(name: string) {
    // Same guard as applyFormat: menu accelerators fire regardless of focus,
    // so without it a chord on the welcome screen would act on a hidden
    // document.
    if (showWelcome) return
    const cmd = FOLD_COMMANDS[name]
    if (cmd) editor.runCommand(cmd)
  }
```

`foldAllCodeBlocks` is a `StateCommand`, which is assignable to `Command` — that
is exactly what Task 2's widening bought.

In `onMount`, subscribe alongside the other menu events:

```ts
    Events.On('menu:fold', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') applyFold(ev.data)
    })
```

- [ ] **Step 4: Add the menu items**

In `menu.go`, inside the existing View submenu block, after the Appearance
submenu loop and before `menu.AddRole(application.WindowMenu)`:

```go
	view.AddSeparator()
	// ⌘⌥[ and ⌘⌥] already fold and unfold the block at the cursor — CodeMirror's
	// foldKeymap binds them, and the webview sees them before AppKit does. These
	// items exist to make that discoverable; the accelerators shown here are
	// reflecting what already happens, not claiming it.
	folds := []struct {
		label string
		key   string
		arg   string
	}{
		{"Fold Block", "cmdorctrl+alt+[", "fold-block"},
		{"Unfold Block", "cmdorctrl+alt+]", "unfold-block"},
	}
	for _, f := range folds {
		arg := f.arg
		view.Add(f.label).SetAccelerator(f.key).OnClick(func(*application.Context) {
			app.Event.Emit("menu:fold", arg)
		})
	}

	view.AddSeparator()
	// No accelerators: an invented chord cannot be checked against every macOS
	// binding, and the menu item is the discoverable route — the same reasoning
	// as Blockquote in the Format menu.
	view.Add("Fold All Code Blocks").OnClick(func(*application.Context) {
		app.Event.Emit("menu:fold", "fold-all-code")
	})
	view.Add("Unfold All").OnClick(func(*application.Context) {
		app.Event.Emit("menu:fold", "unfold-all")
	})
```

- [ ] **Step 5: Widen the keymap warning in CLAUDE.md**

The architecture section warns to check `defaultKeymap` before adding an
accelerator. Extend that sentence so the next person checks `foldKeymap` too:

Find the sentence ending `Check `defaultKeymap` before adding an accelerator.`
and replace it with:

```
Check `defaultKeymap` *and* `foldKeymap` before adding an accelerator — `foldKeymap` claims ⌘⌥[ and ⌘⌥] for folding, which the View menu reflects rather than re-binds, since the keystroke already does what the menu item says.
```

- [ ] **Step 6: Run everything**

```bash
cd <repo>/frontend && npx vitest run && npm run check && npm run build
cd <repo> && gofmt -l . | grep -v '^build/' ; go vet ./. && go test ./. && go build -o /dev/null .
```
Expected: 207 tests across 17 files; `0 ERRORS`; both builds succeed; no gofmt
output; Go tests pass.

- [ ] **Step 7: Commit**

```bash
cd <repo>
git add frontend/src/App.svelte frontend/src/App.test.ts menu.go CLAUDE.md
git commit -m "$(cat <<'EOF'
feat: surface block folding in the View menu

Folding already worked — basicSetup ships foldGutter and foldKeymap, and
lang-markdown supplies fold ranges for fenced code — but a gutter arrow was
the only affordance, and ⌘⌥[ was undiscoverable.

Four items. Two reflect chords CodeMirror already owns, which is the whole
point of listing them. Two are new and take no accelerator, following the
precedent Blockquote sets: an invented chord cannot be verified against
every macOS binding.

Widens the CLAUDE.md keymap warning to foldKeymap, since the next person
will hit the same trap from a different direction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Record it

**Files:**
- Modify: `CHANGELOG.md` (repo root)

- [ ] **Step 1: Add the changelog entry**

`## [Unreleased]` does not currently exist — the last release closed it. Add
one above `## [0.5.0]`, with an `### Added` and a `### Fixed`:

```markdown
## [Unreleased]

### Added

- Block folding is now visible in the View menu: Fold Block and Unfold Block
  (⌘⌥[ and ⌘⌥], which already worked but were undiscoverable), plus Fold All
  Code Blocks and Unfold All. Folding a `vega-lite` or code block keeps its
  opening fence line and hides the body, so a long chart spec stops crowding
  the prose around it. Fold All Code Blocks leaves headings and tables alone.

### Fixed

- A folded block no longer shows a light-grey placeholder in dark mode.
```

- [ ] **Step 2: Verify and commit**

```bash
cd <repo>/frontend && npx vitest run && npm run check
cd <repo> && go test ./.
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: record block folding in the changelog

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification summary

| After task | Frontend tests | Files |
|---|---|---|
| Baseline | 199 | 16 |
| 1 | 204 | 17 |
| 2 | 205 | 17 |
| 3 | 207 | 17 |
| 4 | 207 | 17 |

If a count comes out lower, a test was skipped rather than the arithmetic being
wrong — check before continuing.

## Manual check, once, at the end

jsdom has no cascade, so no test here proves the menu or the placeholder
*looks* right.

```bash
cd <repo> && wails3 task run
```

1. Open `docs/sample-paper.md`. The View menu should show all four items, with
   ⌘⌥[ and ⌘⌥] displayed against the first two.
2. **Fold All Code Blocks** — the chart spec collapses to its ` ```vega-lite `
   line; headings and tables stay open.
3. Switch Appearance → Dark with a block folded. **The placeholder pill must
   follow the theme**, not stay light grey — this is the check no test covers.
4. **Unfold All** restores everything. ⌘Z after Fold All does **not** — folds
   are state effects, not document changes, and CodeMirror never registers
   `foldEffect` with `invertedEffects`, so they sit outside the undo history.
   Undo instead reverts whatever text change preceded the fold. Unfold All is
   the only way back.
