<script lang="ts">
  import { onMount } from 'svelte'
  import { Events } from '@wailsio/runtime'
  import { DocumentService } from '../bindings/hermes'
  import Editor from './Editor.svelte'
  import Preview from './Preview.svelte'
  import { render } from './lib/renderer'
  import { debounce } from './lib/debounce'

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
  let toastTimer: ReturnType<typeof setTimeout>

  const updatePreview = debounce((text: string) => {
    html = render(text)
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

  function onEditorChange(text: string) {
    content = text
    welcomeDismissed = true
    updatePreview(text)
  }

  function loadDocument(docPath: string, docContent: string) {
    path = docPath
    content = docContent
    welcomeDismissed = true
    editor.setContent(docContent) // fires onEditorChange
    savedContent = docContent
    html = render(docContent)
    void refreshRecents()
  }

  async function refreshRecents() {
    recents = (await DocumentService.RecentFiles()) ?? []
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
    editor.setContent('') // fires onEditorChange
    content = ''
    savedContent = ''
    html = ''
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
    <section class="editor-pane" style="width: {editorWidth}%">
      <Editor bind:this={editor} onchange={onEditorChange} />
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
          <li><button onclick={() => requestOpenRecent(r)}>{r}</button></li>
        {/each}
      </ul>
      <button class="welcome-new" onclick={() => (welcomeDismissed = true)}>New document</button>
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
