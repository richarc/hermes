# Hermes v1 Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Wails desktop app for writing academic papers in markdown with live-rendered LaTeX math and Vega-Lite charts, exported to PDF by printing the preview.

**Architecture:** Split-view single window: CodeMirror 6 editor (left) and live HTML preview (right). All rendering happens in the frontend (`markdown-it` + KaTeX + `vega-embed`); Go owns file I/O (native dialogs, recents), the native menu, and print/close integration. Spec: `docs/superpowers/specs/2026-07-27-hermes-editor-design.md`.

**Tech Stack:** Go 1.25 + Wails v3.0.0-alpha2.118, Svelte 5 (runes), TypeScript, Vite, CodeMirror 6, markdown-it, KaTeX (via `@vscode/markdown-it-katex`), vega-embed, Vitest.

## Global Constraints

- TDD everywhere a test is practical: failing test → verify fail → minimal code → verify pass → commit.
- Rendering rule from spec: bad input renders a visible error **in place** — never a blank or broken preview.
- Zero external toolchain dependencies: PDF comes from the webview's native print panel (`WebviewWindow.Print()`, verified present in wails v3.0.0-alpha2.118; on macOS it opens the print panel with "Save as PDF").
- `markdown-it` runs with `html: false` — raw HTML in documents stays escaped (XSS safety, since preview uses `innerHTML`).
- Frontend commands run in `frontend/`; Go commands at repo root. Go build gate is `go build .` (NOT `./...` — `build/ios` is scaffold code that doesn't compile on desktop).
- After changing any Go service's exported API, regenerate bindings: `wails3 task common:generate:bindings`.
- Wails APIs verified in the installed module and safe to use as written: `application.Get().Dialog.OpenFile()/SaveFile()` (fluent, `PromptForSingleSelection() (string, error)`), `app.Menu.SetApplicationMenu`, `menu.AddRole(application.AppMenu)`, `item.SetAccelerator("cmdorctrl+o")`, `item.OnClick(func(*application.Context))`, `app.Event.Emit(name string, data ...any)`, `win.RegisterHook(events.Common.WindowClosing, fn)` + `e.Cancel()`, `win.Print()`.

## File Structure

| File | Responsibility |
|---|---|
| `main.go` (modify) | App/window setup, service registration, closing hook |
| `menu.go` (create) | Native menu with File actions emitting events |
| `documentservice.go` (create) | File read/write, recents persistence, dialogs, dirty flag, print/quit |
| `documentservice_test.go` (create) | Table tests for the file/recents core |
| `greetservice.go` (delete) | Template demo, removed |
| `frontend/src/lib/renderer.ts` | Pure markdown→HTML pipeline (markdown-it + KaTeX + vega fence rule) |
| `frontend/src/lib/renderer.test.ts` | Renderer unit tests |
| `frontend/src/lib/debounce.ts` + `.test.ts` | Debounce util |
| `frontend/src/lib/charts.ts` + `.test.ts` | Vega placeholder hydration with per-spec cache and error cards |
| `frontend/src/Editor.svelte` | CodeMirror 6 wrapper |
| `frontend/src/Preview.svelte` | HTML swap + chart hydration |
| `frontend/src/App.svelte` (rewrite) | Layout, document state, menu-event wiring, modals, toasts |
| `frontend/public/style.css` (modify) | App styles + `@media print` stylesheet |
| `frontend/vitest.config.ts` (create) | Vitest config |

---

### Task 1: Strip the template demo

**Files:**
- Delete: `greetservice.go`
- Modify: `main.go` (remove GreetService registration, time-event goroutine, `RegisterEvent` init, `time` import)
- Modify: `frontend/src/App.svelte` (replace with minimal shell)

**Interfaces:**
- Produces: a clean `main.go` whose `application.Options.Services` list is empty, ready for Task 6/7 to add `DocumentService`.

- [ ] **Step 1: Delete greetservice.go and edit main.go**

Remove: the whole `init()` block, the `Services:` entry for GreetService, the time-emitting goroutine, and the now-unused `time` import. Change `Name` to `"Hermes"`, `Description` to `"Academic markdown editor"`, window `Title` to `"Hermes"`, `Width: 1200, Height: 800`, `BackgroundColour: application.NewRGB(255, 255, 255)`.

- [ ] **Step 2: Replace App.svelte with a minimal shell**

```svelte
<script lang="ts">
</script>

<main class="app">
  <p>Hermes</p>
</main>
```

- [ ] **Step 3: Verify gates**

Run: `go build -o /dev/null .` → succeeds. Run in `frontend/`: `npm run check` → 0 errors (the old GreetService import is gone so stale bindings don't matter).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: strip wails template demo"
```

---

### Task 2: Renderer — markdown pipeline (+ Vitest setup)

**Files:**
- Create: `frontend/src/lib/renderer.ts`, `frontend/src/lib/renderer.test.ts`, `frontend/vitest.config.ts`
- Modify: `frontend/package.json` (deps + `"test": "vitest run"` script)

**Interfaces:**
- Produces: `render(markdown: string): string` — pure, synchronous. Later tasks (Preview, App) call exactly this.

- [ ] **Step 1: Install dependencies**

```bash
cd frontend && npm install markdown-it && npm install -D vitest @types/markdown-it
```

- [ ] **Step 2: Create vitest config and test script**

`frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
})
```
Add to `frontend/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Write the failing tests**

`frontend/src/lib/renderer.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { render } from './renderer'

describe('render: markdown', () => {
  it('renders headings', () => {
    expect(render('# Introduction')).toContain('<h1>Introduction</h1>')
  })

  it('renders emphasis and paragraphs', () => {
    const html = render('Some *emphasised* text')
    expect(html).toContain('<p>')
    expect(html).toContain('<em>emphasised</em>')
  })

  it('escapes raw HTML (html: false)', () => {
    expect(render('<script>alert(1)</script>')).not.toContain('<script>')
  })

  it('renders ordinary fenced code blocks as code', () => {
    const html = render('```python\nprint(1)\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('print(1)')
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/renderer.test.ts`
Expected: FAIL — cannot resolve `./renderer`.

- [ ] **Step 5: Minimal implementation**

`frontend/src/lib/renderer.ts`:
```ts
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true })

export function render(markdown: string): string {
  return md.render(markdown)
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/renderer.test.ts` → PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend && git commit -m "feat: markdown rendering pipeline with vitest setup"
```

---

### Task 3: Renderer — KaTeX math

**Files:**
- Modify: `frontend/src/lib/renderer.ts`, `frontend/src/lib/renderer.test.ts`, `frontend/package.json`, `frontend/index.html`

**Interfaces:**
- Consumes/Produces: same `render()` signature; output now contains KaTeX HTML for `$..$` / `$$..$$`.

- [ ] **Step 1: Install dependencies**

```bash
cd frontend && npm install katex @vscode/markdown-it-katex && npm install -D @types/katex
```

- [ ] **Step 2: Write the failing tests** (append to `renderer.test.ts`)

```ts
describe('render: math', () => {
  it('renders inline math with $..$', () => {
    expect(render('Euler: $e^{i\\pi} = -1$')).toContain('katex')
  })

  it('renders display math with $$..$$', () => {
    expect(render('$$\\int_0^1 x\\,dx$$')).toContain('katex-display')
  })

  it('renders invalid LaTeX as an inline error instead of throwing', () => {
    const html = render('$\\notacommand$')
    expect(html).toContain('katex')          // still produced output
    expect(html).toContain('#cc0000')        // errorColor styling present
  })

  it('leaves plain dollar amounts alone', () => {
    expect(render('costs $5 total')).not.toContain('katex')
  })
})
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `cd frontend && npx vitest run src/lib/renderer.test.ts`
Expected: the 4 math tests FAIL; the markdown tests still pass.

- [ ] **Step 4: Implement**

In `renderer.ts`:
```ts
import katex from '@vscode/markdown-it-katex'

md.use(katex, { throwOnError: false, errorColor: '#cc0000' })
```
(If the default import trips TS, use `import * as katexPlugin from '@vscode/markdown-it-katex'` and `md.use(katexPlugin.default, …)` — pick whichever compiles, verify with `npm run check`.)

KaTeX HTML needs its stylesheet: add to `frontend/index.html` `<head>`:
```html
<link rel="stylesheet" href="./node_modules/katex/dist/katex.min.css" />
```
If Vite doesn't resolve that path from index.html, instead add `import 'katex/dist/katex.min.css'` at the top of `frontend/src/main.ts`. Verify one of the two works in the dev build (fonts render).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/renderer.test.ts` → PASS (8 tests). If the invalid-LaTeX assertion on `#cc0000` fails, inspect the actual output with `console.log(render('$\\notacommand$'))` and assert on the real error marker the plugin emits (e.g. class `katex-error`) — the requirement is only: no throw, visible inline error.

- [ ] **Step 6: Commit**

```bash
git add frontend && git commit -m "feat: KaTeX math rendering for inline and display formulas"
```

---

### Task 4: Renderer — vega-lite fences

**Files:**
- Modify: `frontend/src/lib/renderer.ts`, `frontend/src/lib/renderer.test.ts`

**Interfaces:**
- Produces: ` ```vega-lite ` fences become `<div class="vega-lite-chart" data-spec="<html-escaped JSON text>"></div>`. Task 8's `hydrateCharts` reads exactly `.vega-lite-chart` and `dataset.spec`.

- [ ] **Step 1: Write the failing tests** (append to `renderer.test.ts`)

```ts
describe('render: vega-lite fences', () => {
  const spec = '{"mark": "bar", "data": {"values": [{"a": 1}]}}'

  it('turns a vega-lite fence into a chart placeholder', () => {
    const html = render('```vega-lite\n' + spec + '\n```')
    expect(html).toContain('class="vega-lite-chart"')
    expect(html).not.toContain('<pre>')
  })

  it('carries the spec text, HTML-escaped, in data-spec', () => {
    const html = render('```vega-lite\n' + spec + '\n```')
    expect(html).toContain('data-spec="')
    expect(html).toContain('&quot;mark&quot;')
  })

  it('passes malformed JSON through for the hydrator to report', () => {
    const html = render('```vega-lite\nnot json\n```')
    expect(html).toContain('class="vega-lite-chart"')
    expect(html).toContain('not json')
  })

  it('does not hijack other fence languages', () => {
    expect(render('```json\n{}\n```')).toContain('<pre>')
  })
})
```

- [ ] **Step 2: Run to verify they fail** — first three FAIL, fourth passes (default fence renderer).

- [ ] **Step 3: Implement** (in `renderer.ts`, after `md.use(...)`)

```ts
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim() === 'vega-lite') {
    return `<div class="vega-lite-chart" data-spec="${md.utils.escapeHtml(token.content.trim())}"></div>\n`
  }
  return defaultFence(tokens, idx, options, env, self)
}
```

- [ ] **Step 4: Run to verify all pass** — `npx vitest run src/lib/renderer.test.ts` → 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "feat: vega-lite fenced blocks render as chart placeholders"
```

---

### Task 5: Debounce utility

**Files:**
- Create: `frontend/src/lib/debounce.ts`, `frontend/src/lib/debounce.test.ts`

**Interfaces:**
- Produces: `debounce<Args>(fn: (...args: Args) => void, wait: number): (...args: Args) => void`. App (Task 10) uses it with `wait = 250`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/debounce.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from './debounce'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once with the last arguments after the wait', () => {
    const fn = vi.fn()
    const d = debounce(fn, 250)
    d('a'); d('b'); d('c')
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledExactlyOnceWith('c')
  })

  it('resets the timer on each call', () => {
    const fn = vi.fn()
    const d = debounce(fn, 250)
    d('a')
    vi.advanceTimersByTime(200)
    d('b')
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledExactlyOnceWith('b')
  })
})
```

- [ ] **Step 2: Run to verify FAIL** (module missing), then implement:

`frontend/src/lib/debounce.ts`:
```ts
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}
```

- [ ] **Step 3: Run to verify PASS, then commit**

```bash
git add frontend && git commit -m "feat: debounce utility"
```

---

### Task 6: DocumentService core (Go, TDD)

**Files:**
- Create: `documentservice.go`, `documentservice_test.go`

**Interfaces:**
- Produces (used by frontend bindings and main.go):
  - `Document` struct: fields `Path string` and `Content string`, JSON-tagged lowercase (`path`, `content`)
  - `NewDocumentService(recentsPath string) *DocumentService`
  - `OpenPath(path string) (Document, error)` — read file, record in recents
  - `Save(path, content string) error` — write file, record in recents, clear dirty
  - `RecentFiles() []string` — most-recent-first, deduped, max 10; `[]string{}` on any read error
  - `SetDirty(bool)` / `IsDirty() bool` — thread-safe (atomic)
- Dialog/window methods come in Task 7; keep this task free of `application` imports so tests run headless.

- [ ] **Step 1: Write the failing tests**

`documentservice_test.go`:
```go
package main

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func newTestService(t *testing.T) *DocumentService {
	t.Helper()
	return NewDocumentService(filepath.Join(t.TempDir(), "recents.json"))
}

func TestSaveAndOpenPathRoundTrip(t *testing.T) {
	s := newTestService(t)
	path := filepath.Join(t.TempDir(), "paper.md")

	if err := s.Save(path, "# Title\n$x^2$\n"); err != nil {
		t.Fatalf("Save: %v", err)
	}
	doc, err := s.OpenPath(path)
	if err != nil {
		t.Fatalf("OpenPath: %v", err)
	}
	if doc.Path != path || doc.Content != "# Title\n$x^2$\n" {
		t.Errorf("got %+v", doc)
	}
}

func TestOpenPathMissingFile(t *testing.T) {
	s := newTestService(t)
	if _, err := s.OpenPath(filepath.Join(t.TempDir(), "nope.md")); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestRecentsOrderDedupeAndCap(t *testing.T) {
	s := newTestService(t)
	dir := t.TempDir()

	var paths []string
	for i := 0; i < 12; i++ {
		p := filepath.Join(dir, string(rune('a'+i))+".md")
		if err := s.Save(p, "x"); err != nil {
			t.Fatalf("Save: %v", err)
		}
		paths = append(paths, p)
	}
	// re-open an old file: it must move to the front, not duplicate
	if _, err := s.OpenPath(paths[5]); err != nil {
		t.Fatalf("OpenPath: %v", err)
	}

	recents := s.RecentFiles()
	if len(recents) != 10 {
		t.Fatalf("want 10 recents, got %d", len(recents))
	}
	if recents[0] != paths[5] {
		t.Errorf("want %s first, got %s", paths[5], recents[0])
	}
	count := 0
	for _, r := range recents {
		if r == paths[5] {
			count++
		}
	}
	if count != 1 {
		t.Errorf("path duplicated %d times in recents", count)
	}
	if slices.Contains(recents, paths[0]) {
		t.Error("oldest entry should have been evicted")
	}
}

func TestRecentsCorruptFileReturnsEmpty(t *testing.T) {
	s := newTestService(t)
	if err := os.MkdirAll(filepath.Dir(s.recentsPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.recentsPath, []byte("{corrupt"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := s.RecentFiles(); len(got) != 0 {
		t.Errorf("want empty recents, got %v", got)
	}
}

func TestDirtyFlag(t *testing.T) {
	s := newTestService(t)
	if s.IsDirty() {
		t.Error("new service should not be dirty")
	}
	s.SetDirty(true)
	if !s.IsDirty() {
		t.Error("should be dirty after SetDirty(true)")
	}
	path := filepath.Join(t.TempDir(), "p.md")
	if err := s.Save(path, "x"); err != nil {
		t.Fatal(err)
	}
	if s.IsDirty() {
		t.Error("Save should clear dirty")
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./. -run 'TestSave|TestOpen|TestRecents|TestDirty' -v`
Expected: compile FAIL — `DocumentService` undefined.

- [ ] **Step 3: Implement**

`documentservice.go`:
```go
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sync/atomic"
)

const maxRecents = 10

type Document struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type DocumentService struct {
	recentsPath string
	dirty       atomic.Bool
}

func NewDocumentService(recentsPath string) *DocumentService {
	return &DocumentService{recentsPath: recentsPath}
}

func (s *DocumentService) OpenPath(path string) (Document, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Document{}, err
	}
	s.addRecent(path)
	return Document{Path: path, Content: string(data)}, nil
}

func (s *DocumentService) Save(path, content string) error {
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return err
	}
	s.addRecent(path)
	s.dirty.Store(false)
	return nil
}

func (s *DocumentService) RecentFiles() []string {
	data, err := os.ReadFile(s.recentsPath)
	if err != nil {
		return []string{}
	}
	var recents []string
	if err := json.Unmarshal(data, &recents); err != nil {
		return []string{}
	}
	return recents
}

func (s *DocumentService) SetDirty(dirty bool) {
	s.dirty.Store(dirty)
}

func (s *DocumentService) IsDirty() bool {
	return s.dirty.Load()
}

func (s *DocumentService) addRecent(path string) {
	recents := s.RecentFiles()
	recents = slices.DeleteFunc(recents, func(p string) bool { return p == path })
	recents = append([]string{path}, recents...)
	if len(recents) > maxRecents {
		recents = recents[:maxRecents]
	}
	if err := os.MkdirAll(filepath.Dir(s.recentsPath), 0o755); err != nil {
		return
	}
	data, err := json.Marshal(recents)
	if err != nil {
		return
	}
	_ = os.WriteFile(s.recentsPath, data, 0o644)
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `go test ./. -v` → all 5 tests PASS. Also `go build -o /dev/null .` still succeeds.

- [ ] **Step 5: Commit**

```bash
git add documentservice.go documentservice_test.go
git commit -m "feat: DocumentService core - file io, recents, dirty flag (TDD)"
```

---

### Task 7: Go OS integration — dialogs, menu, print, closing hook

**Files:**
- Modify: `documentservice.go` (dialog/window methods), `main.go` (service registration, window ref, closing hook)
- Create: `menu.go`

**Interfaces:**
- Consumes: Task 6's `DocumentService`.
- Produces (frontend-visible):
  - Bindings: `Open() (Document, error)` (cancel → zero-value `Document`, `Path` empty), `SaveAs(content string) (string, error)` (cancel → `""`), `ExportPDF()`, `Quit()` — plus Task 6's `OpenPath`, `Save`, `RecentFiles`, `SetDirty`.
  - Events emitted by Go, subscribed with `Events.On(name, cb)` (no payload): `"menu:open"`, `"menu:save"`, `"menu:save-as"`, `"close:confirm"`.
  - Menu: File → Open… (⌘O), Save (⌘S), Save As… (⇧⌘S), separator, Export PDF… (⌘E, calls `win.Print()` directly).

- [ ] **Step 1: Add dialog/window methods to documentservice.go**

Append (new imports: `"github.com/wailsapp/wails/v3/pkg/application"`); add field `window *application.WebviewWindow` to the struct:
```go
func (s *DocumentService) Open() (Document, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle("Open Markdown File").
		AddFilter("Markdown files", "*.md;*.markdown").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return Document{}, err
	}
	return s.OpenPath(path)
}

func (s *DocumentService) SaveAs(content string) (string, error) {
	path, err := application.Get().Dialog.SaveFile().
		SetTitle("Save Markdown File").
		SetFilename("untitled.md").
		PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err
	}
	if err := s.Save(path, content); err != nil {
		return "", err
	}
	return path, nil
}

func (s *DocumentService) ExportPDF() {
	if s.window != nil {
		_ = s.window.Print()
	}
}

func (s *DocumentService) Quit() {
	application.Get().Quit()
}
```
These are thin wrappers over native dialogs — not unit-testable headless; covered by the manual smoke test below. The Task 6 tests must still pass untouched.

- [ ] **Step 2: Create menu.go**

```go
package main

import "github.com/wailsapp/wails/v3/pkg/application"

func setupMenu(app *application.App, win *application.WebviewWindow) {
	menu := application.NewMenu()
	menu.AddRole(application.AppMenu)

	file := menu.AddSubmenu("File")
	file.Add("Open…").SetAccelerator("cmdorctrl+o").OnClick(func(*application.Context) {
		app.Event.Emit("menu:open")
	})
	file.Add("Save").SetAccelerator("cmdorctrl+s").OnClick(func(*application.Context) {
		app.Event.Emit("menu:save")
	})
	file.Add("Save As…").SetAccelerator("shift+cmdorctrl+s").OnClick(func(*application.Context) {
		app.Event.Emit("menu:save-as")
	})
	file.AddSeparator()
	file.Add("Export PDF…").SetAccelerator("cmdorctrl+e").OnClick(func(*application.Context) {
		_ = win.Print()
	})

	menu.AddRole(application.EditMenu)
	menu.AddRole(application.WindowMenu)

	app.Menu.SetApplicationMenu(menu)
}
```

- [ ] **Step 3: Wire main.go**

After the imports gain `"github.com/adrg/xdg"` and `"github.com/wailsapp/wails/v3/pkg/events"`:
```go
recentsPath, err := xdg.DataFile("hermes/recents.json")
if err != nil {
	log.Fatal(err)
}
docs := NewDocumentService(recentsPath)
```
Register in options: `Services: []application.Service{ application.NewService(docs) }`. After the window is created:
```go
docs.window = win

win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
	if docs.IsDirty() {
		e.Cancel()
		app.Event.Emit("close:confirm")
	}
})

setupMenu(app, win)
```
Note: `xdg` moves from indirect to direct in `go.mod` — run `go mod tidy`.

- [ ] **Step 4: Verify — build, tests, bindings**

Run: `go build -o /dev/null .` → OK. `go test ./.` → still 5 PASS. Then `wails3 task common:generate:bindings` and confirm `frontend/bindings/hermes/` now exports `DocumentService` with `Open`, `OpenPath`, `Save`, `SaveAs`, `RecentFiles`, `SetDirty`, `ExportPDF`, `Quit`.

- [ ] **Step 5: Manual smoke test**

Run `wails3 dev`: menu bar shows Hermes/File/Edit/Window; ⌘E opens the macOS print panel (proves the print path); Open… shows a file dialog. Close the app.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: native menu, file dialogs, print export, closing hook"
```

---

### Task 8: Chart hydration with cache (charts.ts)

**Files:**
- Create: `frontend/src/lib/charts.ts`, `frontend/src/lib/charts.test.ts`
- Modify: `frontend/package.json` (deps)

**Interfaces:**
- Consumes: Task 4's placeholder contract (`.vega-lite-chart`, `dataset.spec`).
- Produces (Preview uses this in Task 9):
  - `hydrateCharts(container: HTMLElement, cache: Map<string, HTMLElement>, embed?: (el: HTMLElement, specText: string) => Promise<void>): Promise<void>`
  - `embedChart(el: HTMLElement, specText: string): Promise<void>` — default embedder: JSON.parse → `vegaEmbed(el, spec, { actions: false })`; on parse or embed failure renders an error card (`.chart-error`, text starts with `Chart error:`) into `el`.
  - Cache semantics: keyed by exact spec text; cached elements are moved into the new DOM (`placeholder.replaceWith(cached)`) so unchanged charts don't re-render; stale keys evicted after each pass.

- [ ] **Step 1: Install dependencies**

```bash
cd frontend && npm install vega vega-lite vega-embed && npm install -D jsdom
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/lib/charts.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { hydrateCharts, embedChart } from './charts'

vi.mock('vega-embed', () => ({
  default: vi.fn(async (el: HTMLElement) => {
    el.appendChild(document.createElement('svg'))
  }),
}))

function containerWith(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

const SPEC = '{"mark": "bar"}'
const placeholder = (spec: string) =>
  `<div class="vega-lite-chart" data-spec="${spec.replace(/"/g, '&quot;')}"></div>`

describe('hydrateCharts', () => {
  it('embeds every placeholder and caches by spec text', async () => {
    const embed = vi.fn(async () => {})
    const cache = new Map<string, HTMLElement>()
    const container = containerWith(placeholder(SPEC))

    await hydrateCharts(container, cache, embed)

    expect(embed).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
  })

  it('reuses the cached element instead of re-embedding an unchanged spec', async () => {
    const embed = vi.fn(async (el: HTMLElement) => {
      el.textContent = 'RENDERED'
    })
    const cache = new Map<string, HTMLElement>()

    const first = containerWith(placeholder(SPEC))
    await hydrateCharts(first, cache, embed)

    const second = containerWith(placeholder(SPEC))
    await hydrateCharts(second, cache, embed)

    expect(embed).toHaveBeenCalledTimes(1)
    expect(second.textContent).toContain('RENDERED')
  })

  it('evicts cache entries whose spec is no longer in the document', async () => {
    const embed = vi.fn(async () => {})
    const cache = new Map<string, HTMLElement>()

    await hydrateCharts(containerWith(placeholder(SPEC)), cache, embed)
    await hydrateCharts(containerWith(placeholder('{"mark": "line"}')), cache, embed)

    expect(cache.size).toBe(1)
    expect(cache.has('{"mark": "line"}')).toBe(true)
  })
})

describe('embedChart', () => {
  it('renders an error card for invalid JSON', async () => {
    const el = document.createElement('div')
    await embedChart(el, 'not json')
    expect(el.classList.contains('chart-error')).toBe(true)
    expect(el.textContent).toContain('Chart error:')
  })

  it('embeds valid specs via vega-embed', async () => {
    const el = document.createElement('div')
    await embedChart(el, SPEC)
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.classList.contains('chart-error')).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify FAIL** (module missing): `npx vitest run src/lib/charts.test.ts`

- [ ] **Step 4: Implement**

`frontend/src/lib/charts.ts`:
```ts
import vegaEmbed from 'vega-embed'

export async function hydrateCharts(
  container: HTMLElement,
  cache: Map<string, HTMLElement>,
  embed: (el: HTMLElement, specText: string) => Promise<void> = embedChart,
): Promise<void> {
  const placeholders = Array.from(
    container.querySelectorAll<HTMLElement>('.vega-lite-chart'),
  )
  const liveSpecs = new Set<string>()

  for (const el of placeholders) {
    const specText = el.dataset.spec ?? ''
    liveSpecs.add(specText)
    const cached = cache.get(specText)
    if (cached) {
      el.replaceWith(cached)
      continue
    }
    await embed(el, specText)
    cache.set(specText, el)
  }

  for (const key of cache.keys()) {
    if (!liveSpecs.has(key)) cache.delete(key)
  }
}

export async function embedChart(el: HTMLElement, specText: string): Promise<void> {
  let spec: unknown
  try {
    spec = JSON.parse(specText)
  } catch (err) {
    renderChartError(el, `Invalid JSON: ${(err as Error).message}`)
    return
  }
  try {
    await vegaEmbed(el, spec as Parameters<typeof vegaEmbed>[1], { actions: false })
  } catch (err) {
    renderChartError(el, (err as Error).message)
  }
}

function renderChartError(el: HTMLElement, message: string): void {
  el.classList.add('chart-error')
  el.textContent = `Chart error: ${message}`
}
```
Note: error cards are cached like successes — the error persists until the spec text changes, which is the desired behavior.

- [ ] **Step 5: Run to verify PASS**: `npx vitest run src/lib/charts.test.ts` → 5 tests PASS. Full suite `npm test` still green.

- [ ] **Step 6: Commit**

```bash
git add frontend && git commit -m "feat: vega chart hydration with per-spec cache and error cards"
```

---

### Task 9: Editor and Preview components

**Files:**
- Create: `frontend/src/Editor.svelte`, `frontend/src/Preview.svelte`
- Modify: `frontend/package.json` (deps)

**Interfaces:**
- Consumes: `render()` is NOT called here — Preview receives finished HTML. Charts: Task 8's `hydrateCharts`.
- Produces (App consumes in Task 10):
  - `Editor`: props `{ onchange: (text: string) => void }`; exported method `setContent(text: string): void` (full document replace, used on file open).
  - `Preview`: props `{ html: string }`; renders into `.preview-pane`, hydrates charts after each swap.

No practical unit tests for these thin wrappers (CodeMirror and DOM swap are library glue; the logic they delegate to is already tested). Gate: `npm run check` + the Task 10 manual checklist.

- [ ] **Step 1: Install CodeMirror**

```bash
cd frontend && npm install codemirror @codemirror/lang-markdown @codemirror/language-data
```

- [ ] **Step 2: Create Editor.svelte**

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView, basicSetup } from 'codemirror'
  import { markdown } from '@codemirror/lang-markdown'
  import { languages } from '@codemirror/language-data'

  let { onchange }: { onchange: (text: string) => void } = $props()

  let host: HTMLElement
  let view: EditorView

  export function setContent(text: string): void {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    })
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onchange(u.state.doc.toString())
        }),
      ],
    })
    return () => view.destroy()
  })
</script>

<div class="editor-host" bind:this={host}></div>
```

- [ ] **Step 3: Create Preview.svelte**

```svelte
<script lang="ts">
  import { hydrateCharts } from './lib/charts'

  let { html }: { html: string } = $props()

  let container: HTMLElement
  const chartCache = new Map<string, HTMLElement>()

  $effect(() => {
    container.innerHTML = html
    void hydrateCharts(container, chartCache)
  })
</script>

<div class="preview-pane" bind:this={container}></div>
```

- [ ] **Step 4: Verify and commit**

`npm run check` → 0 errors (unused-component warnings acceptable until Task 10 wires them).
```bash
git add frontend && git commit -m "feat: Editor (CodeMirror 6) and Preview components"
```

---

### Task 10: App shell — layout, state, and flows

**Files:**
- Modify: `frontend/src/App.svelte` (full rewrite), `frontend/public/style.css` (replace template styles with app styles), `frontend/index.html` (title "Hermes"; drop template font preloads if unused)

**Interfaces:**
- Consumes: everything above — `render`, `debounce`, `Editor`, `Preview`, `DocumentService` bindings, menu/close events.
- Produces: the working application. State model (Svelte 5 runes): `path: string | null`, `content: string`, `dirty: boolean`, `html: string`, `recents: string[]`, `pendingAction: 'quit' | 'open' | null`, `toastMsg: string`.

- [ ] **Step 1: Rewrite App.svelte**

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { Events } from '@wailsio/runtime'
  import { DocumentService } from '../bindings/hermes'
  import Editor from './Editor.svelte'
  import Preview from './Preview.svelte'
  import { render } from './lib/renderer'
  import { debounce } from './lib/debounce'

  let path: string | null = $state(null)
  let content = $state('')
  let dirty = $state(false)
  let html = $state('')
  let recents: string[] = $state([])
  let pendingAction: 'quit' | 'open' | null = $state(null)
  let toastMsg = $state('')
  let editor: ReturnType<typeof Editor>
  let toastTimer: ReturnType<typeof setTimeout>

  const updatePreview = debounce((text: string) => {
    html = render(text)
  }, 250)

  const filename = $derived(path ? path.split('/').pop() : 'Untitled')
  const showWelcome = $derived(path === null && content === '' && recents.length > 0)

  function toast(msg: string) {
    toastMsg = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastMsg = ''), 4000)
  }

  function onEditorChange(text: string) {
    content = text
    if (!dirty) {
      dirty = true
      void DocumentService.SetDirty(true)
    }
    updatePreview(text)
  }

  function loadDocument(docPath: string, docContent: string) {
    path = docPath
    content = docContent
    editor.setContent(docContent)   // fires onEditorChange; reset dirty after
    dirty = false
    void DocumentService.SetDirty(false)
    html = render(docContent)
    void refreshRecents()
  }

  async function refreshRecents() {
    recents = await DocumentService.RecentFiles()
  }

  function requestOpen() {
    if (dirty) {
      pendingAction = 'open'
      return
    }
    void doOpen()
  }

  async function doOpen() {
    try {
      const doc = await DocumentService.Open()
      if (!doc.path) return // cancelled
      loadDocument(doc.path, doc.content)
    } catch (err) {
      toast(`Could not open file: ${err}`)
    }
  }

  async function openRecent(p: string) {
    try {
      const doc = await DocumentService.OpenPath(p)
      loadDocument(doc.path, doc.content)
    } catch (err) {
      toast(`Could not open ${p}: ${err}`)
    }
  }

  /** Returns true if the document was saved (false = cancelled/failed). */
  async function save(): Promise<boolean> {
    try {
      if (path) {
        await DocumentService.Save(path, content)
      } else {
        const newPath = await DocumentService.SaveAs(content)
        if (!newPath) return false // cancelled
        path = newPath
        void refreshRecents()
      }
      dirty = false
      return true
    } catch (err) {
      toast(`Could not save: ${err}`)
      return false
    }
  }

  async function saveAs() {
    try {
      const newPath = await DocumentService.SaveAs(content)
      if (!newPath) return
      path = newPath
      dirty = false
      void refreshRecents()
    } catch (err) {
      toast(`Could not save: ${err}`)
    }
  }

  async function confirmSave() {
    if (await save()) finishPending()
    else pendingAction = null
  }

  function confirmDiscard() {
    dirty = false
    void DocumentService.SetDirty(false)
    finishPending()
  }

  function finishPending() {
    const action = pendingAction
    pendingAction = null
    if (action === 'quit') void DocumentService.Quit()
    else if (action === 'open') void doOpen()
  }

  onMount(() => {
    Events.On('menu:open', requestOpen)
    Events.On('menu:save', () => void save())
    Events.On('menu:save-as', () => void saveAs())
    Events.On('close:confirm', () => (pendingAction = 'quit'))
    void refreshRecents()
  })
</script>

<div class="app">
  <header class="toolbar">
    <button onclick={requestOpen}>Open</button>
    <button onclick={() => void save()}>Save</button>
    <button onclick={() => void DocumentService.ExportPDF()}>Export PDF</button>
  </header>

  <main class="panes">
    <section class="editor-pane">
      <Editor bind:this={editor} onchange={onEditorChange} />
    </section>
    <Preview {html} />
  </main>

  <footer class="status-bar">
    <span>{filename}{dirty ? ' •' : ''}</span>
  </footer>

  {#if showWelcome}
    <div class="welcome">
      <h2>Recent files</h2>
      <ul>
        {#each recents as r (r)}
          <li><button onclick={() => void openRecent(r)}>{r}</button></li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if pendingAction}
    <div class="modal-backdrop">
      <div class="modal" role="alertdialog">
        <p>“{filename}” has unsaved changes.</p>
        <div class="modal-buttons">
          <button onclick={() => void confirmSave()}>Save</button>
          <button onclick={confirmDiscard}>Don't Save</button>
          <button onclick={() => (pendingAction = null)}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}

  {#if toastMsg}
    <div class="toast" role="status">{toastMsg}</div>
  {/if}
</div>
```
Note the `loadDocument` ordering: `editor.setContent` synchronously fires `onEditorChange` (which sets `dirty = true`), so `dirty = false` MUST come after it.

- [ ] **Step 2: Replace frontend/public/style.css app chrome**

Replace the template's demo styles with (keep the Inter `@font-face` if `index.html` still references the font, else delete it):
```css
* { margin: 0; padding: 0; box-sizing: border-box; }

html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }

.app { display: flex; flex-direction: column; height: 100vh; }

.toolbar {
  display: flex; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid #ddd; -webkit-app-region: drag;
}
.toolbar button { -webkit-app-region: no-drag; }

.panes { flex: 1; display: flex; min-height: 0; }
.editor-pane { width: 50%; border-right: 1px solid #ddd; overflow: auto; }
.editor-host, .editor-host .cm-editor { height: 100%; }
.preview-pane { flex: 1; overflow: auto; padding: 24px 32px; }

.status-bar {
  padding: 4px 12px; border-top: 1px solid #ddd;
  font-size: 12px; color: #666;
}

.welcome {
  position: absolute; inset: 0; background: white;
  padding: 48px; overflow: auto;
}
.welcome ul { list-style: none; margin-top: 12px; }
.welcome button { display: block; padding: 6px 0; }

.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4);
  display: grid; place-items: center;
}
.modal { background: white; border-radius: 8px; padding: 24px; max-width: 400px; }
.modal-buttons { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }

.toast {
  position: fixed; bottom: 16px; right: 16px;
  background: #333; color: white; padding: 10px 16px; border-radius: 6px;
}

.chart-error {
  border: 1px solid #cc0000; background: #fff5f5; color: #cc0000;
  padding: 12px; border-radius: 6px; font-family: monospace; font-size: 13px;
}
```
The spec calls for a draggable divider between the panes. Add its style:
```css
.divider { width: 4px; cursor: col-resize; background: #eee; flex-shrink: 0; }
```
And in `App.svelte`, replace the two panes with a width-tracked version:
```svelte
<main class="panes">
  <section class="editor-pane" style="width: {editorWidth}%">
    <Editor bind:this={editor} onchange={onEditorChange} />
  </section>
  <div
    class="divider"
    onmousedown={startDrag}
    role="separator"
    aria-orientation="vertical"
  ></div>
  <Preview {html} />
</main>
```
with (in the script block; remove `width: 50%` from `.editor-pane` CSS):
```ts
let editorWidth = $state(50)

function startDrag(e: MouseEvent) {
  e.preventDefault()
  const move = (ev: MouseEvent) => {
    editorWidth = Math.min(80, Math.max(20, (ev.clientX / window.innerWidth) * 100))
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
```

- [ ] **Step 3: Verify gates**

`npm run check` → 0 errors. `npm test` → all green. `go build -o /dev/null .` → OK.

- [ ] **Step 4: Manual end-to-end checklist (`wails3 dev`)**

1. Type `# Test` + `$e^{i\pi}$` + a ` ```vega-lite ` block with `{"mark": "bar", "data": {"values": [{"x": 1, "y": 2}]}, "encoding": {"x": {"field": "x"}, "y": {"field": "y"}}}` → heading, formula, and bar chart appear in preview within ~1s.
2. Type prose after the chart → chart does not flicker (cache hit).
3. Break the JSON → red error card in place; rest of the doc still rendered. Fix it → chart returns.
4. `$\notacommand$` → red inline error, no blank preview.
5. ⌘S → save dialog (no path yet) → file written; status bar shows name, no dot.
6. Edit → dot appears. ⌘S → dot clears.
7. Quit with unsaved changes → modal appears; Cancel keeps app open; Save saves and quits.
8. Relaunch (`wails3 dev` again) → welcome pane lists the file; click → opens.
9. Drag divider → panes resize.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: app shell - split view, file flows, dirty tracking, welcome pane"
```

---

### Task 11: Print stylesheet + final verification

**Files:**
- Modify: `frontend/public/style.css` (print rules), `CLAUDE.md` (commands/architecture refresh)

**Interfaces:**
- Consumes: the `.preview-pane` DOM and `WebviewWindow.Print()` wiring from Tasks 7/10.

- [ ] **Step 1: Append print stylesheet**

```css
@media print {
  .toolbar, .status-bar, .editor-pane, .divider, .welcome, .toast, .modal-backdrop {
    display: none !important;
  }
  .panes { display: block; }
  .preview-pane {
    overflow: visible; padding: 0;
    font-size: 11pt; line-height: 1.5;
  }
  .katex-display, .vega-lite-chart, .chart-error { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  @page { margin: 2cm; }
}
```

- [ ] **Step 2: Manual verification**

In `wails3 dev`, with a document containing a heading, both math forms, and a chart: ⌘E → print panel → PDF dropdown → "Save as PDF". Open the PDF: only the rendered document (no toolbar/editor), math typeset, chart crisp (SVG), sensible margins. Also verify the toolbar "Export PDF" button does the same.

- [ ] **Step 3: Update CLAUDE.md**

- Commands: add `cd frontend && npm test` (Vitest) and `go test ./.`; keep the `go build .`-not-`./...` note.
- Architecture: replace the `GreetService` example with `DocumentService` (`documentservice.go`), and describe the frontend pipeline files (`lib/renderer.ts`, `lib/charts.ts`, `Editor/Preview/App.svelte`) and the events used (`menu:*`, `close:confirm`).

- [ ] **Step 4: Full gate**

`cd frontend && npm test && npm run check` → green. `go test ./. && go build -o /dev/null .` → green. `wails3 build` → completes.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: print stylesheet for PDF export; docs refresh"
```
