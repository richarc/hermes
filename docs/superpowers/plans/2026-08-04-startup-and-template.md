# Startup Route and New-Document Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the welcome pane its own `Open…` button, and start every new document from a frontmatter template that makes the bibliography feature discoverable.

**Architecture:** The template is a constant in its own module so its inertness is testable without mounting anything. `App.svelte` gains one place that creates a templated document — `doNew()` — which both File → New and a first launch call. The welcome pane becomes self-sufficient rather than being moved below the toolbar.

**Tech Stack:** Svelte 5 (runes, `mount`/`flushSync`), TypeScript, Vitest, jsdom, CodeMirror 6.

**Spec:** [docs/superpowers/specs/2026-08-04-startup-and-template-design.md](../specs/2026-08-04-startup-and-template-design.md)

## Global Constraints

- All work is in `frontend/`. **No Go changes** — `menu:new` already exists and the template is frontend-only.
- Run every command from `frontend/`. The shell's working directory persists between calls; `cd` explicitly if unsure.
- Svelte 5 runes only (`$state`, `$derived`, `$effect`). No Svelte 4 store syntax.
- Verification commands: `npx vitest run`, `npm run check` (must report `0 ERRORS`), `npm run build`.
- Baseline before starting: **129 tests passing, 8 test files.**
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Component tests: after `mount()`, you **must** call `flushSync()` before asserting. Svelte 5 runs `onMount` and effects in a microtask, so without it the DOM is still empty. This was verified during planning — the failure mode is a confusing `expected null not to be null`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/documentTemplate.ts` (create) | The template string. Nothing else. |
| `src/lib/documentTemplate.test.ts` (create) | Proves the commented keys are inert and the template renders empty. |
| `src/Editor.svelte` (modify) | `setContent` lands the cursor at end-of-document. |
| `src/Editor.test.ts` (create) | First component test; no Wails mocking needed. |
| `src/App.svelte` (modify) | Welcome pane buttons; `doNew()` seeds the template; `onMount` templates a first launch. |
| `src/App.test.ts` (create) | Component tests behind a mocked Wails boundary. |
| `public/style.css` (modify) | Layout for two side-by-side welcome-pane buttons. |
| `vitest.config.ts` (modify) | Svelte plugin + browser resolve condition, so `.svelte` files transform in tests. |
| `CHANGELOG.md`, `ROADMAP.md` (modify) | Record the shipped items. |

---

## Task 1: The template constant

**Files:**
- Create: `frontend/src/lib/documentTemplate.ts`
- Test: `frontend/src/lib/documentTemplate.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from `./frontmatter`, `render` from `./renderer`, `STYLE_IDS` from `./citations` (all existing).
- Produces: `NEW_DOCUMENT_TEMPLATE: string` — imported by `App.svelte` in Task 4.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/documentTemplate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { NEW_DOCUMENT_TEMPLATE } from './documentTemplate'
import { parseFrontmatter } from './frontmatter'
import { STYLE_IDS } from './citations'
import { render } from './renderer'

describe('NEW_DOCUMENT_TEMPLATE', () => {
  // The whole point of commenting the keys out: a live `bibliography:` naming
  // a file that does not exist would toast "Bibliography not found" on every
  // new document.
  it('leaves the bibliography and csl keys inert', () => {
    const fm = parseFrontmatter(NEW_DOCUMENT_TEMPLATE)
    expect(fm.bibliography).toBeUndefined()
    expect(fm.csl).toBeUndefined()
  })

  it('renders to nothing, because the frontmatter is stripped', () => {
    expect(render(NEW_DOCUMENT_TEMPLATE).trim()).toBe('')
  })

  it('names every bundled citation style', () => {
    for (const id of STYLE_IDS) {
      expect(NEW_DOCUMENT_TEMPLATE).toContain(id)
    }
  })

  it('ends with a newline, so the cursor lands below the closing fence', () => {
    expect(NEW_DOCUMENT_TEMPLATE.endsWith('---\n')).toBe(true)
  })

  it('stays short enough to delete in one motion', () => {
    expect(NEW_DOCUMENT_TEMPLATE.trimEnd().split('\n').length).toBeLessThanOrEqual(8)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/documentTemplate.test.ts`
Expected: FAIL — cannot resolve `./documentTemplate`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/documentTemplate.ts`:

```ts
/**
 * Seed text for a new document.
 *
 * The `bibliography` and `csl` keys are deliberately commented out. A live key
 * naming a file that does not exist would fire the "Bibliography not found"
 * toast on every new document. `parseFrontmatter` only matches lines starting
 * with a letter, so a `#` line is inert for free.
 *
 * The guidance is YAML comments *inside* the fences rather than HTML comments:
 * the renderer runs markdown-it with `html: false`, so `<!-- ... -->` would be
 * escaped and show up as literal text in the preview, whereas the frontmatter
 * block is stripped wholesale.
 *
 * It names all five bundled styles because they are otherwise documented only
 * in the README, and a user who does not know them cannot use `csl:` at all.
 */
export const NEW_DOCUMENT_TEMPLATE = `---
# To cite: put a .bib file beside this document, name
# it below, then write [@key] in your text. Styles:
# apa, chicago-author-date, ieee, vancouver, harvard.
# bibliography: references.bib
# csl: apa
---
`
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/documentTemplate.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentTemplate.ts src/lib/documentTemplate.test.ts
git commit -m "$(cat <<'EOF'
feat: add the new-document template constant

Frontmatter with the bibliography and csl keys commented out, so a new
document cannot fire the "Bibliography not found" toast, and guidance in
YAML comments inside the fences, because the renderer escapes HTML.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Cursor at end of document, and Svelte component tests

**Files:**
- Modify: `frontend/vitest.config.ts`
- Modify: `frontend/src/Editor.svelte:44-48` (`setContent`)
- Test: `frontend/src/Editor.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `setContent(text)` leaves the cursor at `text.length`. Task 4 relies on this so a user typing after File → New types *below* the frontmatter. Also produces the working component-test configuration that Task 3 builds on.

**Why `Editor` first:** it has no Wails dependencies, so it exercises the new test configuration without any mocking. Task 3 introduces mocking separately.

- [ ] **Step 1: Update the vitest config so `.svelte` files transform**

`vitest.config.ts` currently has no Svelte plugin, so importing a component in a test fails. Replace the file with:

```ts
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  // Svelte 5 ships separate browser and server builds. Without the browser
  // condition the server build loads and mount() has no DOM to render into.
  resolve: { conditions: ['browser'] },
  test: { environment: 'node' },
})
```

Node remains the default environment; component tests opt into jsdom per-file, the way `charts.test.ts` already does.

- [ ] **Step 2: Confirm the config change breaks nothing**

Run: `npx vitest run`
Expected: PASS, 134 tests across 9 files — unchanged from the end of Task 1. (Verified during planning — the browser condition does not disturb citeproc or the bibtex parser.)

- [ ] **Step 3: Write the failing test**

Create `frontend/src/Editor.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import Editor from './Editor.svelte'

interface EditorApi {
  setContent(text: string): void
  insertAtCursor(text: string): void
}

/**
 * Mounts the editor and reports the document text back through onchange,
 * which is more precise than reading CodeMirror's rendered DOM.
 */
function mountEditor() {
  const target = document.createElement('div')
  document.body.appendChild(target)
  let latest = ''
  const cmp = mount(Editor, {
    target,
    props: { onchange: (text: string) => (latest = text) },
  }) as unknown as EditorApi
  flushSync() // Svelte 5 runs onMount in a microtask; without this the editor does not exist yet
  return {
    target,
    editor: cmp,
    text: () => latest,
    cleanup: () => unmount(cmp as never),
  }
}

describe('Editor.setContent', () => {
  it('leaves the cursor at the end, so typing continues below the text', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('---\n# csl: apa\n---\n')
    flushSync()

    editor.insertAtCursor('BODY')
    flushSync()

    expect(text()).toBe('---\n# csl: apa\n---\nBODY')
    cleanup()
  })

  it('replaces the whole document rather than appending to it', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('first')
    flushSync()
    editor.setContent('second')
    flushSync()

    expect(text()).toBe('second')
    cleanup()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/Editor.test.ts`
Expected: FAIL on the first test with `expected 'BODY---\n# csl: apa\n---\n' to be '---\n# csl: apa\n---\nBODY'` — the cursor is currently at offset 0, so the insert lands at the top. The second test should already pass.

- [ ] **Step 5: Implement**

In `frontend/src/Editor.svelte`, replace `setContent`:

```ts
  export function setContent(text: string): void {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      // Land the cursor at the end so typing after File → New continues below
      // the frontmatter instead of above it.
      selection: { anchor: text.length },
    })
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/Editor.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx vitest run && npm run check`
Expected: 136 tests across 10 files; `0 ERRORS`.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts src/Editor.svelte src/Editor.test.ts
git commit -m "$(cat <<'EOF'
feat: land the cursor at the end after setContent

setContent set no selection at all, so the cursor stayed at offset 0 and a
user typing after File → New would type above the frontmatter rather than
below it.

Adds the Svelte plugin and browser resolve condition to the vitest config so
component tests can mount components at all, and the project's first
component test with them. Editor has no Wails dependencies, so it exercises
the configuration without any mocking.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The welcome pane's Open… button

**Files:**
- Modify: `frontend/src/App.svelte:388` (welcome pane markup)
- Modify: `frontend/public/style.css:74-83` (`.welcome` rules)
- Test: `frontend/src/App.test.ts` (create)

**Interfaces:**
- Consumes: the vitest configuration from Task 2.
- Produces: `mountApp()` and `buttonByText()` helpers, plus the `vi.hoisted` Wails mock harness, all reused by Tasks 4 and 5. Keep them exported-by-position at the top of the file so later tasks extend rather than duplicate them.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/App.test.ts`. The `vi.hoisted` wrapper is required: `vi.mock` factories are hoisted above imports, so they cannot close over ordinary top-level `const`s.

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

const { DocumentService, listeners, recents } = vi.hoisted(() => {
  const listeners: Record<string, (ev: { data: unknown }) => void> = {}
  const recents = { current: [] as string[] }
  return {
    listeners,
    recents,
    DocumentService: {
      RecentFiles: vi.fn(async () => recents.current),
      SetDirty: vi.fn(async () => {}),
      WatchBibliography: vi.fn(async () => {}),
      ReadBibliography: vi.fn(async () => ''),
      Open: vi.fn(async () => ({ path: '', content: '' })),
      OpenPath: vi.fn(async () => ({ path: '', content: '' })),
      Save: vi.fn(async () => {}),
      SaveAs: vi.fn(async () => ''),
      Quit: vi.fn(async () => {}),
      PickCitations: vi.fn(async () => ''),
      ExportPDF: vi.fn(async () => {}),
    },
  }
})

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: (name: string, cb: (ev: { data: unknown }) => void) => {
      listeners[name] = cb
    },
  },
  Browser: { OpenURL: vi.fn() },
}))
vi.mock('../bindings/hermes', () => ({ DocumentService }))

import App from './App.svelte'

function mountApp() {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(App, { target })
  flushSync() // Svelte 5 runs onMount in a microtask
  return { target, cleanup: () => unmount(cmp) }
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
}

beforeEach(() => {
  recents.current = []
  vi.clearAllMocks()
})

describe('welcome pane', () => {
  it('offers both New document and Open… when recents exist', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()

    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    expect(buttonByText(target, 'New document')).toBeDefined()
    expect(buttonByText(target, 'Open…')).toBeDefined()

    cleanup()
  })

  it('routes Open… through the same file dialog as the toolbar', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'Open…')).toBeDefined())

    buttonByText(target, 'Open…')!.click()
    flushSync()

    expect(DocumentService.Open).toHaveBeenCalled()
    cleanup()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.test.ts`
Expected: FAIL — `expected undefined to be defined` for the `Open…` button; the welcome pane currently has only `New document`.

- [ ] **Step 3: Implement the markup**

In `frontend/src/App.svelte`, replace the single welcome button (line 388):

```svelte
      <button class="welcome-new" onclick={() => (welcomeDismissed = true)}>New document</button>
```

with a two-button row:

```svelte
      <div class="welcome-actions">
        <button class="welcome-action" onclick={() => (welcomeDismissed = true)}>New document</button>
        <button class="welcome-action" onclick={requestOpen}>Open…</button>
      </div>
```

`New document` keeps its current behaviour for now; Task 4 changes it.

- [ ] **Step 4: Implement the styling**

In `frontend/public/style.css`, replace the `.welcome button.welcome-new` rule:

```css
.welcome button.welcome-new {
  margin-top: 24px; padding: 8px 16px;
  border: 1px solid #ccc; border-radius: 6px; background: #f5f5f5;
}
```

with a flex row. The `.welcome button { display: block }` rule above still governs the recent-file buttons; the more specific selector below wins for the actions.

```css
.welcome-actions { display: flex; gap: 12px; margin-top: 24px; }
.welcome-actions button.welcome-action {
  display: inline-block; padding: 8px 16px;
  border: 1px solid #ccc; border-radius: 6px; background: #f5f5f5;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/App.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npm run check`
Expected: 138 tests across 11 files; `0 ERRORS`.

- [ ] **Step 7: Commit**

```bash
git add src/App.svelte public/style.css src/App.test.ts
git commit -m "$(cat <<'EOF'
fix: give the welcome pane its own Open… button

The welcome pane is an opaque full-window overlay, so it covered the
toolbar's Open button and the only remaining route to a file outside the
recents list was ⌘O — invisible from that screen.

Adds the App component-test harness, which mocks the Wails runtime and the
generated bindings so the component can mount under jsdom.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: New documents start from the template

**Files:**
- Modify: `frontend/src/App.svelte` — imports, `doNew()` (lines 206-214), welcome `New document` button
- Test: `frontend/src/App.test.ts` (extend)

**Interfaces:**
- Consumes: `NEW_DOCUMENT_TEMPLATE` from Task 1; `setContent`'s end-of-document cursor from Task 2; `mountApp`/`buttonByText`/`listeners` from Task 3.
- Produces: `doNew()` as the single function that creates a templated document. Task 5 calls it.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/App.test.ts`:

```ts
describe('new documents', () => {
  const templated = (target: HTMLElement) =>
    target.querySelector('.editor-pane')?.textContent ?? ''

  it('seeds the template and is not dirty', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New document')).toBeDefined())

    buttonByText(target, 'New document')!.click()
    flushSync()

    expect(templated(target)).toContain('bibliography: references.bib')
    // The status bar appends " •" only while dirty. A template the user never
    // touched must not prompt on close.
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('•')

    cleanup()
  })

  it('produces the same document from File → New as from the button', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())

    listeners['menu:new']({ data: null })
    flushSync()

    expect(templated(target)).toContain('bibliography: references.bib')
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('•')

    cleanup()
  })

  it('dismisses the welcome pane', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()
    await vi.waitFor(() => expect(buttonByText(target, 'New document')).toBeDefined())

    buttonByText(target, 'New document')!.click()
    flushSync()

    expect(target.querySelector('.welcome')).toBeNull()
    cleanup()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.test.ts`
Expected: FAIL on the first two tests — the editor pane contains no template text.

- [ ] **Step 3: Import the template**

In `frontend/src/App.svelte`, add to the imports after the `debounce` import (line 8):

```ts
  import { NEW_DOCUMENT_TEMPLATE } from './lib/documentTemplate'
```

- [ ] **Step 4: Seed the template in `doNew()`**

Replace `doNew()` (lines 206-214):

```ts
  function doNew() {
    path = null
    editor.setContent(NEW_DOCUMENT_TEMPLATE) // fires onEditorChange, queueing a render
    content = NEW_DOCUMENT_TEMPLATE
    // savedContent is seeded too: dirty is derived as content !== savedContent,
    // so seeding only content would make every new document dirty on creation
    // and prompt on close despite the user never touching it.
    savedContent = NEW_DOCUMENT_TEMPLATE
    updatePreview.cancel() // the render below supersedes it
    html = render(NEW_DOCUMENT_TEMPLATE, { formatter })
    welcomeDismissed = true
  }
```

- [ ] **Step 5: Point the welcome button at the same path**

In the welcome pane markup from Task 3, change the `New document` button so both routes produce the same document. It currently only dismisses the overlay without resetting anything.

```svelte
        <button class="welcome-action" onclick={requestNew}>New document</button>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/App.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx vitest run && npm run check`
Expected: 141 tests across 11 files; `0 ERRORS`.

- [ ] **Step 8: Commit**

```bash
git add src/App.svelte src/App.test.ts
git commit -m "$(cat <<'EOF'
feat: start new documents from the template

File → New and the welcome pane's New document button now produce the same
templated document. savedContent is seeded alongside content, because dirty
is derived from the difference between them and a templated document would
otherwise be born dirty and prompt on close untouched.

The welcome button previously only set welcomeDismissed, dismissing the
overlay without resetting the document at all; it now goes through
requestNew like the menu item.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: A first launch starts from the template

**Files:**
- Modify: `frontend/src/App.svelte:329-345` (`onMount`)
- Test: `frontend/src/App.test.ts` (extend)

**Interfaces:**
- Consumes: `doNew()` from Task 4; the harness from Task 3.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/App.test.ts`:

```ts
describe('first launch', () => {
  it('templates the document when there are no recents', async () => {
    recents.current = []
    const { target, cleanup } = mountApp()

    await vi.waitFor(() => {
      expect(target.querySelector('.editor-pane')?.textContent).toContain(
        'bibliography: references.bib',
      )
    })
    expect(target.querySelector('.welcome')).toBeNull()
    expect(target.querySelector('.status-bar')?.textContent).not.toContain('•')

    cleanup()
  })

  it('shows the welcome pane and leaves the document empty when recents exist', async () => {
    recents.current = ['/papers/thesis.md']
    const { target, cleanup } = mountApp()

    await vi.waitFor(() => expect(target.querySelector('.welcome')).not.toBeNull())
    expect(target.querySelector('.editor-pane')?.textContent).not.toContain('bibliography')

    cleanup()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.test.ts`
Expected: FAIL on the first test — `vi.waitFor` times out because a first launch leaves the document empty.

- [ ] **Step 3: Implement**

In `frontend/src/App.svelte`, replace the final line of `onMount` (line 344):

```ts
    void refreshRecents()
```

with:

```ts
    void (async () => {
      await refreshRecents()
      // A first launch has nothing to put in the welcome pane, so go straight
      // into a templated document rather than an empty one — the user who has
      // never seen Hermes is exactly the one the template is for.
      if (recents.length === 0) doNew()
    })()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/App.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full suite, typecheck, and build**

Run: `npx vitest run && npm run check && npm run build`
Expected: 143 tests across 11 files; `0 ERRORS`; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/App.svelte src/App.test.ts
git commit -m "$(cat <<'EOF'
feat: start a first launch from the template

With no recents there is nothing to show in the welcome pane, so the app
opened an empty editor — leaving the user who has never seen Hermes as the
one person who never meets the template.

Templating waits for the recents list rather than seeding unconditionally
and hiding it under the welcome overlay: setContent fires the editor change
handler, which sets welcomeDismissed, so the unconditional version would
suppress the welcome pane permanently for everyone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Record the shipped items

**Files:**
- Modify: `CHANGELOG.md` (repo root)
- Modify: `ROADMAP.md` (repo root)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add the changelog entries**

In `CHANGELOG.md`, under `## [Unreleased]`, add to the existing `### Added` list:

```markdown
- New documents start from a short frontmatter template that shows how to
  point at a `.bib` file and names all five citation styles, so the
  bibliography feature is discoverable without reading the README. It applies
  to File → New, the welcome pane's New document button, and a first launch
  with no recent files. An untouched template does not count as unsaved work,
  so closing straight away does not prompt.
```

And to the existing `### Fixed` list:

```markdown
- The welcome pane now offers an Open… button. It is a full-window overlay, so
  it covered the toolbar's Open button, leaving ⌘O as the only way to reach a
  file that was not already in the recents list — and nothing on that screen
  said so.
- The welcome pane's New document button now creates a new document rather
  than just dismissing the pane.
```

- [ ] **Step 2: Tick the roadmap items**

In `ROADMAP.md`, change the two v0.4 items from `- [ ]` to `- [x]`: the one beginning "Bug: there is no discoverable way to open a document" and the one beginning "New documents start from a template".

- [ ] **Step 3: Verify the whole project one more time**

Run from the repo root:

```bash
cd /Users/richarc/Development/hermes && go test ./. && go build -o /dev/null .
cd frontend && npx vitest run && npm run check && npm run build
```

Expected: Go tests pass and build succeeds (unchanged — no Go was touched); 143 frontend tests; `0 ERRORS`; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: record the startup route and template in the changelog and roadmap

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification summary

| After task | Tests | Files |
|---|---|---|
| Baseline | 129 | 8 |
| 1 | 134 | 9 |
| 2 | 136 | 10 |
| 3 | 138 | 11 |
| 4 | 141 | 11 |
| 5 | 143 | 11 |

Counts assume every test in this plan is written as specified. If a count comes out lower, a test was skipped rather than the arithmetic being wrong — check before continuing.

## Manual check worth doing once

The component tests assert structure, not appearance. After Task 3, run the app and confirm the two welcome-pane buttons sit side by side and clear the traffic lights:

```bash
cd /Users/richarc/Development/hermes && wails3 task run
```
