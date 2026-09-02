# Spell Checking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native macOS spell checking on the document's prose and nothing else, on by default, switched by View → Check Spelling.

**Architecture:** Go gains a `SpellCheck` setting, a View menu checkbox, and a darwin-only cgo call that registers WebKit's continuous-checking default as on. The frontend gains `lib/spellcheck.ts`: a pure `protectedRanges` function (syntax tree for code, URLs and HTML; line rule for frontmatter; patterns for maths and citations) and a `spellcheckExtension` that sets `spellcheck="true"` on the content element and wraps protected ranges in `spellcheck="false"` marks. `Editor.svelte` holds that extension in a `Compartment` driven by a `spellcheck` prop; `App.svelte` feeds the prop from settings.

**Tech Stack:** Go 1.25 + cgo (Foundation), Wails v3 beta.12, CodeMirror 6 (`@codemirror/view` decorations, `@codemirror/language` syntax tree, `@lezer/markdown`), Svelte 5 runes, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-02-spell-checking-design.md`

## Global Constraints

- Go: `go test ./. && go build -o /dev/null .` from the repo root (`.`, not `./...`). Pre-existing `ld: warning: object file ... built for newer 'macOS' version` lines are noise.
- Frontend commands run from `frontend/`: `npx vitest run <file>`, `npx vitest run`, `npm run check`.
- Never hand-edit `frontend/bindings/`; Task 1 regenerates with `wails3 task common:generate:bindings`.
- No literal colours in CSS; this plan adds no CSS.
- Protected node names, exactly: `FencedCode`, `CodeBlock`, `InlineCode`, `URL`, `Autolink`, `HTMLBlock`, `HTMLTag`. Patterns, exactly as written in Task 2. Attribute values are the strings `'true'` and `'false'`.
- Setting key `spellCheck`, Go field `SpellCheck bool`, default `true`. Menu item label `Check Spelling`, in the View menu directly after `Autosave`, no accelerator.
- `wails3 task run` does not build; check `strings "bin/Hermes Editor" | grep -c SpellCheck` is non-zero after `wails3 task build`.
- Commit after each task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Branch `spell-checking` off `main`.
- ROADMAP edits: `str.replace` with `assert s.count(old) == 1`; `grep -c '^- \['` and `grep '^## '` unchanged.

---

## File structure

| File | Responsibility |
|---|---|
| `settings.go`, `settings_test.go` | `SpellCheck` field, default on. |
| `spellcheck_darwin.go` (new), `spellcheck_other.go` (new), `spellcheck_test.go` (new) | `registerSpellCheckingDefaults()` and a darwin read-back helper for its test. |
| `main.go` | Calls it first. |
| `menu.go` | View → Check Spelling checkbox. |
| `frontend/bindings/hermes/*` | Regenerated (`Settings.spellCheck`). |
| `frontend/src/lib/markdownCommands.ts` | Exports `frontmatterEndLine` (already written, currently unexported). |
| `frontend/src/lib/spellcheck.ts` (new) | `protectedRanges`, `spellcheckExtension`. |
| `frontend/src/lib/spellcheck.test.ts` (new) | Range tests per region kind; extension attribute test. |
| `frontend/src/Editor.svelte`, `frontend/src/Editor.test.ts` | `spellcheck` prop, `Compartment`, DOM tests. |
| `frontend/src/App.svelte`, `frontend/src/App.test.ts` | `spellCheck` from settings to the prop. |
| `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `ROADMAP.md` | Docs. |

---

### Task 1: The Go side — setting, default registration, menu, bindings

**Files:**
- Modify: `settings.go`, `settings_test.go`
- Create: `spellcheck_darwin.go`, `spellcheck_other.go`, `spellcheck_test.go`
- Modify: `main.go` (first line of `main`)
- Modify: `menu.go` (View menu, after the Autosave checkbox)
- Regenerate: `frontend/bindings/hermes/*`

**Interfaces:**
- Produces: `Settings.SpellCheck bool` (JSON `spellCheck`, default true); `registerSpellCheckingDefaults()`; on darwin `continuousSpellCheckingDefault() bool`; TS `Settings.spellCheck: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `settings_test.go`:

```go
func TestSpellCheckDefaultsToOn(t *testing.T) {
	if !newTestService(t).Settings().SpellCheck {
		t.Error("spell checking must default to on")
	}
}

func TestSpellCheckPersists(t *testing.T) {
	recentsPath := filepath.Join(t.TempDir(), "recents.json")
	s := NewDocumentService(recentsPath)
	next := s.Settings()
	next.SpellCheck = false
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	if NewDocumentService(recentsPath).Settings().SpellCheck {
		t.Error("want off after update, in a fresh service")
	}
}

// A settings file from before the field existed reads as on: the loader
// unmarshals over the defaults.
func TestSettingsFileWithoutSpellCheckKeyReadsAsOn(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"autoSave":false}`), 0o644); err != nil {
		t.Fatal(err)
	}
	got := NewDocumentService(filepath.Join(dir, "recents.json")).Settings()
	if !got.SpellCheck || got.AutoSave {
		t.Errorf("want spellCheck on with autoSave still off, got %+v", got)
	}
}
```

Create `spellcheck_test.go`:

```go
//go:build darwin

package main

import "testing"

// WebKit reads WebContinuousSpellCheckingEnabled raw from the app's defaults
// with no registered default, so a WKWebView app has continuous checking
// off until something sets the key. registerDefaults supplies the value the
// raw read falls back to; it is not persisted, so calling it in a test does
// not touch the developer's preferences.
func TestRegisterSpellCheckingDefaultsTurnsContinuousCheckingOn(t *testing.T) {
	registerSpellCheckingDefaults()
	if !continuousSpellCheckingDefault() {
		t.Error("want WebContinuousSpellCheckingEnabled to read as true after registering the default")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./. -run 'SpellCheck' -v`
Expected: compile errors (`SpellCheck` undefined, `registerSpellCheckingDefaults` undefined).

- [ ] **Step 3: The setting**

In `settings.go`, add to the struct after `UpdateCheck`:

```go
	// Native spell checking on the document's prose. Applied by the
	// frontend as the editor's spellcheck attribute; WebKit's own
	// continuous-checking flag is registered on in spellcheck_darwin.go.
	SpellCheck bool `json:"spellCheck"`
```

In `defaultSettings`, after `UpdateCheck: "unasked",`:

```go
		SpellCheck:       true,
```

Extend the `normalise` comment naming the bools: `// SyncScrolling, ShowOutline, AutoSave and SpellCheck need no clause: every value a bool can hold is valid.`

- [ ] **Step 4: The default registration**

Create `spellcheck_darwin.go`:

```go
//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation
#import <Foundation/Foundation.h>

static NSString *const hermesContinuousSpellCheckingKey = @"WebContinuousSpellCheckingEnabled";

// WebKit's TextChecker reads this key with boolForKey: and no registered
// default (Source/WebKit/UIProcess/mac/TextCheckerMac.mm), so a WKWebView
// app starts with continuous checking off. registerDefaults sets the value
// the raw read falls back to without writing anything to disk; a value the
// user later sets through a Spelling menu still wins, because it lands in
// the persistent domain that is consulted first.
static void hermesRegisterSpellCheckingDefaults(void) {
	[[NSUserDefaults standardUserDefaults] registerDefaults:@{hermesContinuousSpellCheckingKey: @YES}];
}

static bool hermesContinuousSpellCheckingDefault(void) {
	return [[NSUserDefaults standardUserDefaults] boolForKey:hermesContinuousSpellCheckingKey];
}
*/
import "C"

// registerSpellCheckingDefaults makes WebKit's continuous spell checking
// read as on for this app. Must run before the webview exists, since the
// text checker reads the key on first use.
func registerSpellCheckingDefaults() {
	C.hermesRegisterSpellCheckingDefaults()
}

// continuousSpellCheckingDefault reads the key back the way WebKit does.
// Exists for the test; nothing else needs it.
func continuousSpellCheckingDefault() bool {
	return bool(C.hermesContinuousSpellCheckingDefault())
}
```

Create `spellcheck_other.go`:

```go
//go:build !darwin

package main

// Only WebKit on macOS keeps its spell-checking flag in NSUserDefaults;
// there is nothing to register elsewhere.
func registerSpellCheckingDefaults() {}
```

In `main.go`, make the first statement of `main()`:

```go
	// Before anything WebKit: the text checker reads its defaults on first
	// use. See spellcheck_darwin.go.
	registerSpellCheckingDefaults()
```

- [ ] **Step 5: The menu**

In `menu.go`, directly after the Autosave checkbox block and before `view.AddSeparator()`:

```go
	// Below Autosave: a persisted on/off applied by the editor as its
	// spellcheck attribute (lib/spellcheck.ts). No accelerator.
	view.AddCheckbox("Check Spelling", viewCurrent.SpellCheck).OnClick(func(*application.Context) {
		next := docs.Settings()
		next.SpellCheck = !next.SpellCheck
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save spell checking: %v", err)
		}
	})
```

- [ ] **Step 6: Bindings, tests, build**

Run from the repo root: `wails3 task common:generate:bindings`, then `grep -n 'spellCheck' frontend/bindings/hermes/models.ts` (expect `"spellCheck": boolean;`), then `go test ./. && go build -o /dev/null .` and `(cd frontend && npm run check)`.
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add settings.go settings_test.go spellcheck_darwin.go spellcheck_other.go spellcheck_test.go main.go menu.go frontend/bindings
git commit -m "feat: a SpellCheck setting, View → Check Spelling, and WebKit's continuous-checking default registered on

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `lib/spellcheck.ts` — protected ranges and the extension

**Files:**
- Modify: `frontend/src/lib/markdownCommands.ts` (export `frontmatterEndLine`)
- Create: `frontend/src/lib/spellcheck.ts`
- Create: `frontend/src/lib/spellcheck.test.ts`

**Interfaces:**
- Consumes: `frontmatterEndLine(state)` from `markdownCommands.ts`; `syntaxTree` from `@codemirror/language`; `markdown` + `Table` for the test states.
- Produces:
  ```ts
  export interface Range { from: number; to: number }
  export function protectedRanges(state: EditorState, from: number, to: number): Range[]
  export function spellcheckExtension(): Extension
  ```

- [ ] **Step 1: Export the frontmatter helper**

In `markdownCommands.ts`, change `function frontmatterEndLine(` to `export function frontmatterEndLine(`. Nothing else changes.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/lib/spellcheck.test.ts`:

```ts
// (imports: see the end of this step)

function state(doc: string): EditorState {
  const s = EditorState.create({ doc, extensions: [markdown({ extensions: [Table] })] })
  // The language parses lazily; the tests need the whole tree.
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}

/** The protected substrings of doc, in order, for readable assertions. */
function protectedText(doc: string): string[] {
  const s = state(doc)
  return protectedRanges(s, 0, s.doc.length).map((r) => doc.slice(r.from, r.to))
}

describe('protectedRanges', () => {
  it('leaves plain prose alone', () => {
    expect(protectedText('Some prose with a misspeling in it.\n')).toEqual([])
  })

  it('protects fenced and inline code', () => {
    const doc = 'Prose.\n\n```js\nconst x = 1\n```\n\nUse `foo()` here.\n'
    expect(protectedText(doc)).toEqual(['```js\nconst x = 1\n```', '`foo()`'])
  })

  it('protects indented code blocks', () => {
    const doc = 'Prose.\n\n    indented code\n\nMore prose.\n'
    expect(protectedText(doc)).toEqual(['    indented code'])
  })

  it('protects frontmatter by line', () => {
    const doc = '---\ntitle: Hello\nbibliography: refs.bib\n---\n\nProse.\n'
    expect(protectedText(doc)).toEqual(['---\ntitle: Hello\nbibliography: refs.bib\n---'])
  })

  it('does not treat an unterminated leading --- as frontmatter', () => {
    expect(protectedText('---\nnot closed\n\nProse.\n')).toEqual([])
  })

  it('protects link destinations but not link text', () => {
    const doc = 'See [the docs](https://example.com/pth) and <https://x.org>.\n'
    expect(protectedText(doc)).toEqual(['https://example.com/pth', '<https://x.org>'])
  })

  it('protects HTML', () => {
    const doc = 'Prose <span class="x">inline</span> here.\n\n<div>\nblock\n</div>\n'
    const got = protectedText(doc)
    expect(got).toContain('<span class="x">')
    expect(got).toContain('</span>')
    expect(got.some((t) => t.startsWith('<div>'))).toBe(true)
  })

  it('protects inline and display maths', () => {
    const doc = 'Let $x^2 + y^2$ be given.\n\n$$\n\\int_0^1 f(x)\\,dx\n$$\n\nDone.\n'
    expect(protectedText(doc)).toEqual(['$x^2 + y^2$', '$$\n\\int_0^1 f(x)\\,dx\n$$'])
  })

  it('protects citations, bracketed and bare', () => {
    const doc = 'As shown [@smith2020, p. 3; @doe2021] and by @lee2019 too.\n'
    expect(protectedText(doc)).toEqual(['[@smith2020, p. 3; @doe2021]', '@lee2019'])
  })

  it('does not protect an email-like address as a citation', () => {
    // A bare @ must start a token: "a@b" is not a citation key.
    expect(protectedText('Write to me a@b.org please.\n')).toEqual([])
  })

  it('merges overlapping regions and clips to the window', () => {
    const doc = 'Prose `code with $math$ inside` and $x$.\n'
    const s = state(doc)
    // Whole doc: the inline code swallows the maths inside it.
    expect(protectedRanges(s, 0, s.doc.length).map((r) => doc.slice(r.from, r.to))).toEqual([
      '`code with $math$ inside`',
      '$x$',
    ])
    // A window ending mid-code clips the range rather than dropping it.
    const codeStart = doc.indexOf('`')
    const clipped = protectedRanges(s, 0, codeStart + 5)
    expect(clipped).toEqual([{ from: codeStart, to: codeStart + 5 }])
  })

  it('returns sorted, non-overlapping ranges', () => {
    const doc = '$a$ `b` [@c] <d>e</d> $$f$$\n'
    const s = state(doc)
    const got = protectedRanges(s, 0, s.doc.length)
    for (let i = 1; i < got.length; i++) expect(got[i].from).toBeGreaterThanOrEqual(got[i - 1].to)
  })
})

describe('spellcheckExtension', () => {
  function mountView(doc: string, extensions: Extension[]) {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({ parent, state: EditorState.create({ doc, extensions }) })
    return { view, cleanup: () => { view.destroy(); parent.remove() } }
  }

  it('sets spellcheck="true" on the content element and marks protected text false', () => {
    const { view, cleanup } = mountView('Prose `code` and $x$.\n', [
      markdown({ extensions: [Table] }),
      spellcheckExtension(),
    ])
    forceParsing(view)
    expect(view.contentDOM.getAttribute('spellcheck')).toBe('true')
    const off = [...view.contentDOM.querySelectorAll('[spellcheck="false"]')].map((el) => el.textContent)
    expect(off).toEqual(['`code`', '$x$'])
    cleanup()
  })

  it("leaves CodeMirror's default (off) without the extension", () => {
    const { view, cleanup } = mountView('x', [])
    expect(view.contentDOM.getAttribute('spellcheck')).toBe('false')
    cleanup()
  })
})
```

The file's first line is `// @vitest-environment jsdom`, and its imports are:

```ts
import { describe, it, expect } from 'vitest'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ensureSyntaxTree, forceParsing } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { Table } from '@lezer/markdown'
import { protectedRanges, spellcheckExtension } from './spellcheck'
```

- [ ] **Step 3: Run the tests to verify they fail**

Run from `frontend/`: `npx vitest run src/lib/spellcheck.test.ts`
Expected: FAIL, cannot resolve `./spellcheck`.

- [ ] **Step 4: Write the module**

Create `frontend/src/lib/spellcheck.ts`:

```ts
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { frontmatterEndLine } from './markdownCommands'

export interface Range {
  from: number
  to: number
}

// Nodes whose text is never prose. URL is a link's destination (the text
// stays checked); Autolink is the <https://…> form. Both HTML kinds are
// markup, not words.
const PROTECTED_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'URL', 'Autolink', 'HTMLBlock', 'HTMLTag'])

// Maths and citations are not nodes in the editor's grammar (the preview
// parses them with markdown-it plugins), so they are matched by pattern.
// Display maths first so a $$ pair is never read as two empty inline spans;
// inline maths refuses newlines, matching KaTeX's inline rule; a citation
// key is @ followed by the characters Pandoc allows, and the @ must start a
// token so an address like a@b.org is not one.
const DISPLAY_MATH = /\$\$[\s\S]+?\$\$/g
const INLINE_MATH = /\$(?!\$)[^$\n]+?\$/g
const CITATION_GROUP = /\[@[^\]]+\]/g
const BARE_CITATION = /(?<![\w@])@[\w][\w:.#$%&\-+?<>~/]*/g

/**
 * The parts of [from, to) that must not be spell-checked: code, frontmatter,
 * link destinations, HTML, maths and citations. Sorted, non-overlapping,
 * clipped to the window. Pure: reads only the state.
 */
export function protectedRanges(state: EditorState, from: number, to: number): Range[] {
  const found: Range[] = []

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (!PROTECTED_NODES.has(node.name)) return
      found.push({ from: node.from, to: node.to })
      return false // nothing inside a protected node needs a second range
    },
  })

  const fmEnd = frontmatterEndLine(state)
  if (fmEnd > 0) found.push({ from: 0, to: state.doc.line(fmEnd).to })

  // Patterns run over the whole document rather than the window so a
  // display block that starts above the viewport is still caught; documents
  // are small and this runs once per update.
  const text = state.doc.toString()
  for (const re of [DISPLAY_MATH, INLINE_MATH, CITATION_GROUP, BARE_CITATION]) {
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      found.push({ from: m.index, to: m.index + m[0].length })
    }
  }

  return mergeAndClip(found, from, to)
}

function mergeAndClip(ranges: Range[], from: number, to: number): Range[] {
  const clipped = ranges
    .map((r) => ({ from: Math.max(r.from, from), to: Math.min(r.to, to) }))
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from || a.to - b.to)
  const out: Range[] = []
  for (const r of clipped) {
    const last = out[out.length - 1]
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to)
    else out.push({ ...r })
  }
  return out
}

// WebKit checks per text node and honours the nearest ancestor's spellcheck
// attribute, so a span carrying "false" excludes exactly its text.
const noSpellcheck = Decoration.mark({ attributes: { spellcheck: 'false' } })

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    for (const r of protectedRanges(view.state, from, to)) builder.add(r.from, r.to, noSpellcheck)
  }
  return builder.finish()
}

const protectedRegions = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate) {
      // The tree changing without the document changing is the language's
      // parse worker finishing more of the document.
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/**
 * Native spell checking on prose only: the content element says yes, and
 * every protected range says no. autocorrect stays off — CodeMirror's
 * default — because in-place correction rewrites source.
 */
export function spellcheckExtension(): Extension {
  return [EditorView.contentAttributes.of({ spellcheck: 'true' }), protectedRegions]
}
```

- [ ] **Step 5: Run the tests**

Run from `frontend/`: `npx vitest run src/lib/spellcheck.test.ts`
Expected: PASS, 14 tests. The node names `HTMLBlock`, `HTMLTag`, `Autolink`, `URL`, `CodeBlock`, `FencedCode` and `InlineCode` all exist in the installed `@lezer/markdown` (checked 2026-09-02); if the HTML test's exact substrings differ from the assertion, print `syntaxTree(state).toString()` for that input, adjust the assertion's shape, not the node set, and say so in the report.

Then `npx vitest run && npm run check`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/spellcheck.ts frontend/src/lib/spellcheck.test.ts frontend/src/lib/markdownCommands.ts
git commit -m "feat: protected ranges and a spellcheck extension that checks prose only

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Wire the editor and the app

**Files:**
- Modify: `frontend/src/Editor.svelte` (props, a `Compartment`, `editorExtensions`, an effect)
- Modify: `frontend/src/Editor.test.ts`
- Modify: `frontend/src/App.svelte` (`spellCheck` state, `refreshSettings`, the `<Editor>` tag)
- Modify: `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `spellcheckExtension` (Task 2); `Settings.spellCheck` (Task 1).
- Produces: `Editor` prop `spellcheck?: boolean` (default `true`).

- [ ] **Step 1: Write the failing Editor tests**

In `Editor.test.ts`, `mountEditor` takes no props today; add an optional `props` parameter merged into the mount props: `function mountEditor(extra: Record<string, unknown> = {})` and `props: { onchange: ..., ...extra }`. Then append:

```ts
describe('spell checking', () => {
  it('is on by default: the content element says spellcheck="true"', () => {
    const { target, cleanup } = mountEditor()
    expect(target.querySelector('.cm-content')!.getAttribute('spellcheck')).toBe('true')
    cleanup()
  })

  it('protects code and maths inside the editor', () => {
    const { editor, target, cleanup } = mountEditor()
    editor.setContent('Prose `code` and $x$.\n')
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    forceParsing(view)
    const off = [...target.querySelectorAll('.cm-content [spellcheck="false"]')].map((el) => el.textContent)
    expect(off).toEqual(['`code`', '$x$'])
    cleanup()
  })

})
```

The third test needs a prop that changes after mount, which a plain `.ts` test cannot express. Svelte's Vite plugin compiles runes in any `*.svelte.ts` module, and the default Vitest pattern matches `*.test.ts`, so a file named `Editor.spellcheck.svelte.test.ts` gets both (verified 2026-09-02 with a probe file). Put the toggle test there:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import Editor from './Editor.svelte'

describe('spell checking prop', () => {
  it('turns off when the prop is false, and back on', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = $state({ spellcheck: false, onchange: (_t: string) => {} })
    const cmp = mount(Editor, { target, props })
    flushSync()
    const content = () => target.querySelector('.cm-content')!
    expect(content().getAttribute('spellcheck')).toBe('false')
    props.spellcheck = true
    flushSync()
    await vi.waitFor(() => expect(content().getAttribute('spellcheck')).toBe('true'))
    props.spellcheck = false
    flushSync()
    await vi.waitFor(() => expect(content().getAttribute('spellcheck')).toBe('false'))
    unmount(cmp)
    target.remove()
  })
})
```

The first two tests stay in `Editor.test.ts` (`mountEditor(extra)` passes `spellcheck` once). Add `import { forceParsing } from '@codemirror/language'` to `Editor.test.ts` (it already imports `foldCode` from there).

- [ ] **Step 2: Write the failing App test**

Add `spellCheck: true` to `DEFAULT_SETTINGS` in `App.test.ts`, then append:

```ts
describe('spell checking setting', () => {
  it('reaches the editor: off in settings means spellcheck="false" on the content element', async () => {
    settings.current = { ...DEFAULT_SETTINGS, spellCheck: false }
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
    await vi.waitFor(() =>
      expect(target.querySelector('.cm-content')!.getAttribute('spellcheck')).toBe('false'),
    )
  })

  it('defaults on', async () => {
    const { target } = mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
    await vi.waitFor(() =>
      expect(target.querySelector('.cm-content')!.getAttribute('spellcheck')).toBe('true'),
    )
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

From `frontend/`: `npx vitest run src/Editor.test.ts src/Editor.spellcheck.svelte.test.ts src/App.test.ts -t 'spell'`
Expected: FAIL (attribute is `"false"` everywhere; no `[spellcheck="false"]` spans).

- [ ] **Step 4: Editor.svelte**

Imports: add `Compartment` to the `@codemirror/state` import; add `import { spellcheckExtension } from './lib/spellcheck'`.

Props: add `spellcheck = true` with type `spellcheck?: boolean`:

```ts
  let {
    onchange,
    onformat,
    onscroll,
    spellcheck = true,
  }: {
    onchange: (text: string) => void
    onformat?: (name: string) => void
    onscroll?: () => void
    spellcheck?: boolean
  } = $props()
```

After the theme comment block (before `editorExtensions`), add:

```ts
  // The one Compartment in this editor. The theme needs none (see above);
  // spell checking does, because it is a facet value and a decoration set,
  // not a stylesheet, and View → Check Spelling flips it at runtime.
  const spellcheckCompartment = new Compartment()
  const spellcheckFor = (on: boolean) => (on ? spellcheckExtension() : [])
```

In `editorExtensions()`, add `spellcheckCompartment.of(spellcheckFor(spellcheck)),` after `EditorView.lineWrapping,`.

After `onMount`, add the effect that reconfigures on prop change (it runs once at mount too, which is harmless — a reconfigure to the same value is a no-op):

```ts
  $effect(() => {
    const on = spellcheck
    if (!view) return
    view.dispatch({ effects: spellcheckCompartment.reconfigure(spellcheckFor(on)) })
  })
```

`view` is declared with `let view: EditorView` already; check it is assigned in `onMount` before the effect can run — Svelte runs `$effect` after mount, so it is. If `view` is typed non-optional, the guard needs `let view: EditorView | undefined`; adjust the declaration if so and check other uses still type-check.

- [ ] **Step 5: App.svelte**

State, after `let updateNotice`: `let spellCheck = $state(true)`.
`refreshSettings`, after `updateCheck = ...`: `spellCheck = s.spellCheck`.
The editor tag: `<Editor bind:this={editor} onchange={onEditorChange} onformat={applyFormat} onscroll={onEditorScroll} spellcheck={spellCheck} />`.

- [ ] **Step 6: Run everything**

From `frontend/`: `npx vitest run && npm run check`.
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/Editor.svelte frontend/src/Editor.test.ts frontend/src/Editor.spellcheck.svelte.test.ts frontend/src/App.svelte frontend/src/App.test.ts
git commit -m "feat: View → Check Spelling drives the editor's spellcheck compartment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Documentation, build, and the click-through

**Files:**
- Modify: `README.md` (step 2 of "Your first document"; "Known limitations")
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`, first bullet)
- Modify: `CLAUDE.md` ("Other things to know", after the update-check bullet)
- Modify: `ROADMAP.md` (the Spell checking item)

- [ ] **Step 1: README**

In "Your first document", step 2 currently reads `2. Type markdown on the left. The preview updates as you type.` Change it to:

```markdown
2. Type markdown on the left. The preview updates as you type. Misspelled
   words are underlined as you type them, using macOS's own checker, and a
   right-click offers corrections; code, maths, citation keys, link
   addresses and the frontmatter are left alone. **View → Check Spelling**
   turns it off.
```

In "Known limitations", add a bullet (match the list's existing style):

```markdown
- Spell checking is as-you-type only. macOS checks the word you just typed
  and the word you leave, never a document you open, so an existing paper
  shows no underlines until you edit or move through it. A whole-document
  pass is on the roadmap.
```

- [ ] **Step 2: CHANGELOG**

First bullet under `### Added`:

```markdown
- Spell checking, on by default and switched by View → Check Spelling.
  macOS's own checker underlines misspelled prose as you type and offers
  corrections on right-click; code, maths, citation keys, link addresses,
  HTML and the frontmatter are excluded, so a paper's `[@key]` and `$x^2$`
  do not light up. As-you-type only: an opened document is not scanned
  until you edit it.
```

- [ ] **Step 3: CLAUDE.md**

After the "The update check is `update.go`" bullet:

```markdown
- Spell checking is native WebKit, scoped by attribute: `lib/spellcheck.ts` sets `spellcheck="true"` on the content element and wraps `protectedRanges` (code/URL/HTML from the syntax tree, frontmatter by line, maths and citations by pattern) in `spellcheck="false"` marks, which WebKit honours per element. `Editor.svelte` holds it in the editor's only `Compartment`, driven by the `spellcheck` prop from the `SpellCheck` setting. WebKit's continuous-checking flag has no registered default in a WKWebView app, so `spellcheck_darwin.go` registers `WebContinuousSpellCheckingEnabled` on before the window exists; do not move that call after `application.New`. Coverage is WebKit's: it checks the word typed and the word the caret leaves, never a loaded document — see the roadmap item before treating "no underlines on open" as a bug. `autocorrect` stays off.
```

- [ ] **Step 4: ROADMAP**

```python
import pathlib
p = pathlib.Path('ROADMAP.md'); s = p.read_text()
old = "- [ ] Spell checking. Investigated 2026-09-02 against WebKit's source; the\n      findings below settle the open questions, and the smallest honest\n      version is being built."
new = "- [x] Spell checking. Done 2026-09-02, unreleased, as the smallest honest\n      version: the attribute, the protected-range marks, a `SpellCheck`\n      setting and the registered WebKit default (`docs/superpowers/specs/2026-09-02-spell-checking-design.md`).\n      Investigated the same day against WebKit's source; the findings below\n      settled the open questions."
assert s.count(old) == 1
p.write_text(s.replace(old, new))
```

Check `grep -c '^- \['` is 58 and `grep '^## '` unchanged against `git show HEAD:ROADMAP.md`.

- [ ] **Step 5: Build and hand over**

```bash
go test ./. && go build -o /dev/null . && (cd frontend && npx vitest run && npm run check)
wails3 task build
strings "bin/Hermes Editor" | grep -c SpellCheck
```

Expected: non-zero. Do not launch the app. Ask the user to check:

1. Launch, type `This is a misspeling here.` in the document. After the space following `misspeling`, a red underline appears; right-click on it offers `misspelling`.
2. Type `` `misspeling` `` in backticks, `$misspeling$`, `[@misspeling]`, a `misspeling:` line inside the frontmatter, and a fenced block containing it: none are underlined.
3. Open `docs/test-document.md`: no underlines until you type or arrow through a paragraph (this is WebKit, and the README says so).
4. View → Check Spelling off: new typing gets no underline; relaunch and confirm the checkbox stays off. Turn it back on.
5. Confirm no auto-correction: type `teh ` and see it stay `teh` (underlined).
6. Quit and relaunch with a fresh user (or `defaults delete com.qxquantum.hermes WebContinuousSpellCheckingEnabled`): checking still works on first launch, which is the registered default doing its job.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md ROADMAP.md
git commit -m "docs: spell checking

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec coverage: attribute and marks (Task 2), the seven region kinds (Task 2, each with a test), setting and menu (Task 1), registered default with a test (Task 1), prop and compartment (Task 3), docs and the coverage caveat (Task 4).
- Two earlier uncertainties were checked before execution: the Lezer node names all exist in the installed grammar, and a `*.svelte.test.ts` file compiles runes under this Vitest setup.
- Type consistency: `Settings.SpellCheck` ↔ `spellCheck` ↔ `s.spellCheck`; the Editor prop is `spellcheck` (lower-case, matching the HTML attribute) and App's state is `spellCheck` (matching the setting); `spellcheckExtension()` and `protectedRanges(state, from, to)` are the same in Task 2's tests, its implementation and Task 3's wiring.
