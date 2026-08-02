### Task 8: Editor insertion + App wiring

**Files:**
- Modify: `frontend/src/Editor.svelte`, `frontend/src/App.svelte`, `frontend/public/style.css`

**Interfaces:**
- Consumes: everything above — `parseFrontmatter`, `parseBib`, `createCitationFormatter` (+ `has`), `render(markdown, { formatter })`, bindings `ReadBibliography`/`WatchBibliography`/`PickCitations`, events `bib:changed`/`menu:insert-citation`.
- Produces: the working feature. `Editor.insertAtCursor(text: string)` — inserts at the cursor (replacing any selection), cursor lands after the insertion, editor refocused.

- [ ] **Step 1: Editor.svelte — add below `setContent`:**

```ts
export function insertAtCursor(text: string): void {
  view.dispatch(view.state.replaceSelection(text))
  view.focus()
}
```

- [ ] **Step 2: App.svelte — bibliography state + wiring.** Script additions:

```ts
import { parseFrontmatter } from './lib/frontmatter'
import { parseBib } from './lib/bibliography'
import { createCitationFormatter, type CitationFormatter } from './lib/citations'

let formatter = $state<CitationFormatter | undefined>(undefined)
let bibPath = $state<string | null>(null)

const fm = $derived(parseFrontmatter(content))

// Reload the bibliography when the document's frontmatter changes it,
// when the document path changes, or on bib:changed from the watcher.
async function reloadBibliography() {
  const wanted = fm.bibliography ?? null
  bibPath = wanted
  if (!wanted || !path) {
    formatter = undefined
    void DocumentService.WatchBibliography('', path ?? '')
    return
  }
  try {
    const text = await DocumentService.ReadBibliography(wanted, path)
    const { entries, warnings } = parseBib(text)
    if (warnings.length) toast(`Bibliography: ${warnings.length} entr${warnings.length === 1 ? 'y' : 'ies'} could not be parsed`)
    formatter = createCitationFormatter(entries, fm.csl ?? 'apa')
  } catch {
    formatter = undefined
    toast(`Bibliography not found: ${wanted}`)
  }
  void DocumentService.WatchBibliography(wanted, path)
}

$effect(() => {
  void fm.bibliography
  void fm.csl
  void path
  void reloadBibliography()
})

async function insertCitation() {
  try {
    const picked = await DocumentService.PickCitations()
    if (picked) editor.insertAtCursor(picked)
  } catch {
    toast("Zotero (with Better BibTeX) isn't running")
  }
}
```
Preview rendering: change both render call sites (`updatePreview` debounce and `loadDocument`) to pass `{ formatter }`, and add an effect so a formatter change re-renders the current content:

```ts
import { untrack } from 'svelte'

// Re-render when the FORMATTER changes (bib loaded/reloaded, style change).
// content is read untracked: content changes flow through the debounced
// typing path, not this immediate effect.
$effect(() => {
  void formatter
  html = render(untrack(() => content), { formatter })
})
```
Update the two existing render call sites to pass the formatter: `updatePreview`'s body becomes `html = render(text, { formatter })` (the closure reads the latest `$state` value at call time), and `loadDocument`'s direct call becomes `html = render(docContent, { formatter })` — at load time the new document's bibliography may not be loaded yet, which is fine: the effect above re-renders when `reloadBibliography` lands.

Events in `onMount`:
```ts
Events.On('bib:changed', () => void reloadBibliography())
Events.On('menu:insert-citation', () => void insertCitation())
```
Toolbar: add `<button onclick={() => void insertCitation()}>Cite</button>` after Save. Unknown `csl` id toast: in `reloadBibliography`, after computing the formatter, `if (fm.csl && !STYLE_IDS.includes(fm.csl)) toast(\`Unknown citation style "${fm.csl}" — using APA\`)` (import `STYLE_IDS`).

- [ ] **Step 3: Styles** (`frontend/public/style.css`):

```css
.cite-error {
  color: #cc0000; background: #fff5f5; border-radius: 3px; padding: 0 3px;
}
.preview-pane .csl-bib-body { line-height: 1.7; }
.preview-pane .csl-entry { margin-bottom: 0.5em; }
```
And add `.csl-entry` to the print stylesheet's `break-inside: avoid` list.

- [ ] **Step 4: Gates** — `npm test`, `npm run check` (0 errors; investigate any new warnings), `go build -o /dev/null .`, `wails3 build`. Do NOT launch the GUI.

- [ ] **Step 5: Commit** — `git commit -m "feat: bibliography wiring, Cite button, and citation insertion"`

---

