<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { Events } from '@wailsio/runtime'
  import { DocumentService } from '../bindings/hermes'
  import type { Settings } from '../bindings/hermes/models'
  import Editor from './Editor.svelte'
  import Preview from './Preview.svelte'
  import { render } from './lib/renderer'
  import { debounce } from './lib/debounce'
  import { NEW_DOCUMENT_TEMPLATE } from './lib/documentTemplate'
  import { parseFrontmatter } from './lib/frontmatter'
  import { parseBib } from './lib/bibliography'
  import { resolveTheme, applyTheme, type ThemeSetting } from './lib/theme'
  import { createCitationFormatter, STYLE_IDS, type CitationFormatter } from './lib/citations'
  import {
    unresolvedInsertionMessage,
    unsavedBibliographyMessage,
  } from './lib/citationFeedback'
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

  let path = $state<string | null>(null)
  let content = $state('')
  let savedContent = $state('')
  let html = $state('')
  let recents = $state<string[]>([])
  let pendingAction = $state<'quit' | 'open' | 'new' | null>(null)
  let pendingRecentPath = $state<string | null>(null)
  let welcomeDismissed = $state(false)
  let toastMsg = $state('')
  let editorWidth = $state(50)
  let editor: ReturnType<typeof Editor>
  let preview: ReturnType<typeof Preview>
  let syncScrolling = $state(false)
  let themeSetting = $state<ThemeSetting>('system')
  let systemPrefersDark = $state(false)
  let scrollFrame: number | null = null
  let toastTimer: ReturnType<typeof setTimeout>
  let formatter = $state<CitationFormatter | undefined>(undefined)
  // Guards against a stale ReadBibliography response landing after a newer
  // request (e.g. rapid frontmatter edits or back-to-back bib:changed
  // events): each call captures its generation and bails after every await
  // if a later call has since started, so the latest call always wins.
  let reloadGeneration = 0

  const fm = $derived(parseFrontmatter(content))
  // Svelte's $derived always treats an object return value as "changed" on
  // recomputation (safe_not_equal short-circuits true for objects), so an
  // effect reading fm.bibliography/fm.csl directly would rerun on every
  // keystroke, not just when those fields actually change — since content
  // (and therefore fm) changes on every keystroke. Deriving the primitive
  // fields separately lets each one's own equality check (plain !==) gate
  // correctly, so the reload effect below only fires on a real change.
  const fmBibliography = $derived(fm.bibliography)
  const fmCsl = $derived(fm.csl)

  const updatePreview = debounce((text: string) => {
    html = render(text, { formatter })
  }, 250)

  const filename = $derived(path ? path.split('/').pop() : 'Untitled')
  // Dirty means "differs from what's on disk" — typing back to the saved
  // text (or emptying a never-saved doc) clears it again.
  const dirty = $derived(content !== savedContent)

  // Keep the Go side (window-close hook) in sync with the derived flag.
  $effect(() => {
    void DocumentService.SetDirty(dirty)
  })
  const showWelcome = $derived(
    !welcomeDismissed && path === null && content === '' && recents.length > 0,
  )

  function toast(msg: string) {
    toastMsg = msg
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastMsg = ''), 4000)
  }

  // Reload the bibliography when the document's frontmatter changes it,
  // when the document path changes, or on bib:changed from the watcher.
  async function reloadBibliography() {
    const gen = ++reloadGeneration
    const wanted = fmBibliography ?? null
    if (!wanted || !path) {
      formatter = undefined
      // A named bibliography resolves relative to the document, so an unsaved
      // document cannot load one. Say so rather than failing silently.
      const unsaved = unsavedBibliographyMessage(wanted ?? undefined, path ?? null)
      if (unsaved) toast(unsaved)
      void DocumentService.WatchBibliography('', path ?? '')
      return
    }
    try {
      const text = await DocumentService.ReadBibliography(wanted, path)
      if (gen !== reloadGeneration) return // superseded by a newer request
      const { entries, warnings } = parseBib(text)
      if (warnings.length)
        toast(`Bibliography: ${warnings.length} entr${warnings.length === 1 ? 'y' : 'ies'} could not be parsed`)
      const next = await createCitationFormatter(entries, fmCsl ?? 'apa')
      if (gen !== reloadGeneration) return // superseded while the style loaded
      formatter = next
      if (fmCsl && !STYLE_IDS.includes(fmCsl)) toast(`Unknown citation style "${fmCsl}" — using APA`)
    } catch {
      if (gen !== reloadGeneration) return // superseded by a newer request
      formatter = undefined
      toast(`Bibliography not found: ${wanted}`)
    }
    void DocumentService.WatchBibliography(wanted, path)
  }

  $effect(() => {
    void fmBibliography
    void fmCsl
    void path
    void reloadBibliography()
  })

  // Re-render when the FORMATTER changes (bib loaded/reloaded, style change).
  // content is read untracked: content changes flow through the debounced
  // typing path, not this immediate effect.
  $effect(() => {
    void formatter
    html = render(untrack(() => content), { formatter })
  })

  async function insertCitation() {
    try {
      const picked = await DocumentService.PickCitations()
      if (picked) {
        editor.insertAtCursor(picked)
        // Zotero supplies the key; only the document's .bib can resolve it.
        // Warn when the two disagree, which is the common Zotero setup error.
        const f = formatter
        if (f) {
          const unresolved = unresolvedInsertionMessage(
            picked,
            (key) => f.has(key),
            fmBibliography ?? null,
          )
          if (unresolved) toast(unresolved)
        }
      }
    } catch {
      toast("Zotero (with Better BibTeX) isn't running")
    }
  }

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

  function onEditorChange(text: string) {
    content = text
    welcomeDismissed = true
    updatePreview(text)
  }

  function loadDocument(docPath: string, docContent: string) {
    path = docPath
    content = docContent
    welcomeDismissed = true
    editor.setContent(docContent) // fires onEditorChange, queueing a render
    savedContent = docContent
    // Render now rather than 250 ms from now, and drop the queued pass: it
    // would only re-render this same text.
    updatePreview.cancel()
    html = render(docContent, { formatter })
    void refreshRecents()
  }

  async function refreshRecents() {
    recents = (await DocumentService.RecentFiles()) ?? []
  }

  async function refreshSettings() {
    const s: Settings = await DocumentService.Settings()
    syncScrolling = s.syncScrolling
    themeSetting = s.theme as ThemeSetting
    applyTheme(resolveTheme(themeSetting, systemPrefersDark))
  }

  // Scroll fires in bursts; one measurement per frame is plenty, and coalescing
  // keeps a fast scroll from forcing layout dozens of times.
  function onEditorScroll() {
    if (!syncScrolling || scrollFrame !== null) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null
      if (!syncScrolling) return
      preview.syncToLine(editor.topVisibleLine(), editor.lineCount())
    })
  }

  function requestNew() {
    if (dirty) {
      pendingAction = 'new'
      return
    }
    doNew()
  }

  function doNew() {
    path = null
    // 'end' lands the cursor (and focus) below the frontmatter so the user
    // can start typing immediately; loadDocument() below relies on the
    // 'start' default instead, since opening a file must not relocate where
    // ⌘⇧C and the Format-menu commands act.
    editor.setContent(NEW_DOCUMENT_TEMPLATE, 'end') // fires onEditorChange, queueing a render
    content = NEW_DOCUMENT_TEMPLATE
    // savedContent is seeded too: dirty is derived as content !== savedContent,
    // so seeding only content would make every new document dirty on creation
    // and prompt on close despite the user never touching it. The two
    // assignments must stay in the same synchronous block (no `await` or
    // `flushSync()` between them): Svelte defers effects to a microtask, so
    // as long as both run before the next tick, the Go side's SetDirty(dirty)
    // effect only ever observes the settled, non-dirty state. Splitting them
    // across a suspension point would let that effect fire on the transient
    // content !== savedContent gap and send SetDirty(true) for a fresh,
    // untouched template — prompting to save on close for a document the
    // user never edited.
    savedContent = NEW_DOCUMENT_TEMPLATE
    updatePreview.cancel() // the render below supersedes it
    html = render(NEW_DOCUMENT_TEMPLATE, { formatter })
    welcomeDismissed = true
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

  function requestOpenRecent(p: string) {
    if (dirty) {
      pendingAction = 'open'
      pendingRecentPath = p
      return
    }
    void openRecent(p)
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
    const snapshot = content // what we're writing (content may change mid-await)
    try {
      if (path) {
        await DocumentService.Save(path, snapshot)
      } else {
        const newPath = await DocumentService.SaveAs(snapshot)
        if (!newPath) return false // cancelled
        path = newPath
        void refreshRecents()
      }
      savedContent = snapshot
      return true
    } catch (err) {
      toast(`Could not save: ${err}`)
      return false
    }
  }

  async function saveAs() {
    const snapshot = content
    try {
      const newPath = await DocumentService.SaveAs(snapshot)
      if (!newPath) return
      path = newPath
      savedContent = snapshot
      void refreshRecents()
    } catch (err) {
      toast(`Could not save: ${err}`)
    }
  }

  async function confirmSave() {
    if (await save()) finishPending()
    else pendingAction = null
  }

  async function confirmDiscard() {
    savedContent = content // treat current text as accepted; clears dirty
    await DocumentService.SetDirty(false)
    finishPending()
  }

  function finishPending() {
    const action = pendingAction
    const recentPath = pendingRecentPath
    pendingAction = null
    pendingRecentPath = null
    if (action === 'quit') void DocumentService.Quit()
    else if (action === 'new') doNew()
    else if (action === 'open') {
      if (recentPath) void openRecent(recentPath)
      else void doOpen()
    }
  }

  function onDividerKeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.key === 'ArrowLeft' ? -2 : 2
    editorWidth = Math.min(80, Math.max(20, editorWidth + step))
  }

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

  onMount(() => {
    Events.On('menu:new', requestNew)
    Events.On('menu:open', requestOpen)
    Events.On('menu:open-recent', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') requestOpenRecent(ev.data)
    })
    Events.On('menu:save', () => void save())
    Events.On('menu:save-as', () => void saveAs())
    Events.On('close:confirm', () => (pendingAction = 'quit'))
    Events.On('recents:changed', () => void refreshRecents())
    Events.On('bib:changed', () => void reloadBibliography())
    Events.On('menu:insert-citation', () => void insertCitation())
    Events.On('menu:format', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') applyFormat(ev.data)
    })
    Events.On('settings:changed', () => void refreshSettings())

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    systemPrefersDark = media.matches
    const onSchemeChange = (e: MediaQueryListEvent | { matches: boolean }) => {
      systemPrefersDark = e.matches
      applyTheme(resolveTheme(themeSetting, systemPrefersDark))
    }
    media.addEventListener('change', onSchemeChange)

    void (async () => {
      // allSettled, not all: these two reads are independent, and a rejection
      // from either must not stop the other's effect from applying, nor skip
      // the templating check below. Promise.all would let one rejection sink
      // both — turning a settings-load failure into a blank, template-less
      // editor on top of the settings failure itself.
      await Promise.allSettled([refreshRecents(), refreshSettings()])
      // A first launch has nothing to put in the welcome pane, so go straight
      // into a templated document rather than an empty one — the user who has
      // never seen Hermes is exactly the one the template is for.
      if (recents.length === 0) doNew()
    })()

    return () => media.removeEventListener('change', onSchemeChange)
  })
</script>

<div class="app">
  <header class="toolbar">
    <button onclick={requestOpen}>Open</button>
    <button onclick={() => void save()}>Save</button>
    <button onclick={() => void insertCitation()}>Cite</button>
    <button onclick={() => void DocumentService.ExportPDF()}>Export PDF</button>
  </header>

  <main class="panes">
    <section class="editor-pane" style="width: {editorWidth}%">
      <Editor bind:this={editor} onchange={onEditorChange} onformat={applyFormat} onscroll={onEditorScroll} />
    </section>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -- WAI-ARIA "window splitter" pattern: a focusable separator with arrow-key resizing is the recommended markup -->
    <div
      class="divider"
      onmousedown={startDrag}
      onkeydown={onDividerKeydown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize editor and preview panes"
      aria-valuenow={Math.round(editorWidth)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabindex="0"
    ></div>
    <Preview bind:this={preview} {html} />
  </main>

  <footer class="status-bar">
    <span>{filename}{dirty ? ' •' : ''}</span>
  </footer>

  {#if showWelcome}
    <div class="welcome">
      <h2>Recent files</h2>
      <ul>
        {#each recents as r (r)}
          <li><button onclick={() => requestOpenRecent(r)}>{r}</button></li>
        {/each}
      </ul>
      <div class="welcome-actions">
        <button class="welcome-action" onclick={requestNew}>New document</button>
        <button class="welcome-action" onclick={requestOpen}>Open…</button>
      </div>
    </div>
  {/if}

  {#if pendingAction}
    <div class="modal-backdrop">
      <div class="modal" role="alertdialog">
        <p>"{filename}" has unsaved changes.</p>
        <div class="modal-buttons">
          <button onclick={() => void confirmSave()}>Save</button>
          <button onclick={() => void confirmDiscard()}>Don't Save</button>
          <button
            onclick={() => {
              pendingAction = null
              pendingRecentPath = null
            }}>Cancel</button
          >
        </div>
      </div>
    </div>
  {/if}

  {#if toastMsg}
    <div class="toast" role="status">{toastMsg}</div>
  {/if}
</div>
