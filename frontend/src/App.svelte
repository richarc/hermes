<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { Events, Browser } from '@wailsio/runtime'
  import { DocumentService } from '../bindings/hermes'
  import type { Settings, Draft, UpdateResult } from '../bindings/hermes/models'
  import Editor from './Editor.svelte'
  import Preview from './Preview.svelte'
  import { renderDocument, type RenderOptions } from './lib/renderer'
  import { type OutlineEntry } from './lib/outline'
  import Outline from './Outline.svelte'
  import { debounce } from './lib/debounce'
  import { createDraftKeeper, DRAFT_DEBOUNCE_MS } from './lib/recoveryDraft'
  import {
    NEW_DOCUMENT_TEMPLATE,
    BIBLIOGRAPHY_SEED,
    newDocumentText,
    bibliographyReference,
  } from './lib/documentTemplate'
  import NewDocument, { type BibliographyChoice } from './NewDocument.svelte'
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
  import { foldCode, unfoldCode, unfoldAll } from '@codemirror/language'
  import type { Command } from '@codemirror/view'
  import { foldAllCodeBlocks } from './lib/foldCommands'
  import ChartBuilder from './ChartBuilder.svelte'
  import TableBuilder from './TableBuilder.svelte'
  import { parsePipeTable, serializePipeTable, type PipeTable } from './lib/pipeTable'
  import Dialog from './Dialog.svelte'
  import { readSpec, type BuilderState } from './lib/chartSpec'
  import type { ChartWidth, FigureAlignment } from './lib/figures'
  import {
    DEFAULT_PAPER_SIZE,
    DEFAULT_ORIENTATION,
    type PaperSize,
    type PageOrientation,
  } from './lib/paper'

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
  let showOutline = $state(false)
  let outline = $state<OutlineEntry[]>([])

  let autoSave = $state(true)
  // A draft found on open (or the untitled one at launch), awaiting the
  // user's Restore / Discard Draft. Null when no dialog is up. `key` is the
  // docPath it was offered for, captured up front so Discard Draft still
  // targets the right draft after dismissRecovery has cleared `recovery`.
  let recovery = $state<{ key: string; content: string } | null>(null)
  // One toast per document for a failing draft write: a toast every two
  // seconds while typing would be worse than no insurance.
  let draftWriteWarned = false

  type UpdateCheckSetting = 'unasked' | 'on' | 'off'
  let updateCheck = $state<UpdateCheckSetting>('unasked')
  // The first-launch question; true only until it has been answered once.
  let askUpdates = $state(false)
  // A newer version, awaiting Later / View Release. Null when no dialog is up.
  let updateNotice = $state<UpdateResult | null>(null)
  let spellCheck = $state(true)

  // The keeper decides when a draft is written and discarded; recovery.go
  // decides whether one is worth offering back. Go's own errors are
  // reported here, once, because the keeper swallows them by design.
  const drafts = createDraftKeeper(
    {
      write: (docPath, text) =>
        DocumentService.WriteDraft(docPath, text).catch((err) => {
          if (draftWriteWarned) return
          draftWriteWarned = true
          toast(`Could not write a recovery draft: ${err}`)
        }),
      discard: (docPath) =>
        DocumentService.DiscardDraft(docPath).catch((err) => console.warn('DiscardDraft:', err)),
    },
    DRAFT_DEBOUNCE_MS,
  )

  // Every render feeds both the preview and the outline; one function so a
  // call site cannot update one and leave the other a document behind.
  function renderInto(text: string) {
    const opts: RenderOptions = { formatter, chartWidth, docPath: path }
    const result = renderDocument(text, opts)
    html = result.html
    outline = result.outline
  }

  // The panel's own arrows. The View menu owns the same setting, so this is a
  // read-modify-write of the whole value — the menu only ever changes the
  // field it owns, and so does this.
  async function setOutlineShown(shown: boolean) {
    try {
      const current: Settings = await DocumentService.Settings()
      await DocumentService.UpdateSettings({ ...current, showOutline: shown })
    } catch (err) {
      toast(`Could not save outline visibility: ${err}`)
    }
  }

  // An explicit jump moves both panes, whatever Sync Scrolling says: the
  // author chose that heading, and following is a different thing from
  // being taken there.
  function jumpToLine(line: number) {
    editor.goToLine(line)
    preview.syncToLine(line, editor.lineCount())
  }
  let themeSetting = $state<ThemeSetting>('system')
  let chartWidth = $state<ChartWidth>('medium')
  let figureAlign = $state<FigureAlignment>('centre')
  let paperSize = $state<PaperSize>(DEFAULT_PAPER_SIZE)
  let orientation = $state<PageOrientation>(DEFAULT_ORIENTATION)
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
    renderInto(text)
  }, 250)

  const filename = $derived(path ? path.split('/').pop() : 'Untitled')
  // Dirty means "differs from what's on disk" — typing back to the saved
  // text (or emptying a never-saved doc) clears it again.
  const dirty = $derived(content !== savedContent)

  // Keep the Go side (window-close hook) in sync with the derived flag.
  $effect(() => {
    void DocumentService.SetDirty(dirty)
  })

  // Every input the keeper cares about, in one place. `path ?? ''` is the
  // untitled key on the Go side.
  $effect(() => {
    drafts.update(path ?? '', content, dirty, autoSave)
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

  // Re-render when the FORMATTER or the chart width changes (bib loaded or
  // reloaded, style change, View → Chart Width). content is read untracked:
  // content changes flow through the debounced typing path, not this
  // immediate effect.
  $effect(() => {
    void formatter
    void chartWidth
    renderInto(untrack(() => content))
  })

  async function insertCitation() {
    // Same reasoning as the chartOpen guards below: the chart builder modal
    // does not block the keyboard, so this must refuse to touch the document
    // while it's open rather than trust that focus alone kept it out.
    if (chartOpen || tableOpen) return
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

  let chartOpen = $state(false)
  let chartInitial: BuilderState | null = $state(null)
  let chartTarget: { from: number; to: number } | null = null

  function openChartBuilder() {
    // A second trigger while the builder is already open must be a no-op,
    // not a way to silently retarget it: ChartBuilder reads `initial` once at
    // mount, so reassigning chartInitial here would be ignored — but
    // chartTarget WOULD update, turning a pending insert into a replace of
    // whatever block the cursor happens to be in.
    if (chartOpen) return
    if (tableOpen) return
    // Same guard as applyFormat: menu items fire regardless of focus, so
    // without it this would act on the hidden document behind the welcome pane.
    if (showWelcome) return
    // The unsaved-changes confirm dialog must stay the only modal on screen —
    // opening the builder on top of it would leave its buttons keyboard-
    // reachable behind a chart modal with no focus trap.
    if (pendingAction) return

    const block = editor.enclosingChartBlock()
    if (!block) {
      chartInitial = null
      chartTarget = null
      chartOpen = true
      return
    }

    // An empty fence has no JSON to read, but that's not a refusal case: a
    // fresh builder targeted at replacing this (empty) block is exactly the
    // right thing to open.
    if (block.spec.trim() === '') {
      chartInitial = null
      chartTarget = { from: block.from, to: block.to }
      chartOpen = true
      return
    }

    const result = readSpec(block.spec)
    if (!result.ok) {
      toast(
        result.reason === 'invalid-json'
          ? "That chart block isn't valid JSON, so it can't be opened here."
          : `That chart uses ${result.unconsumed.slice(0, 2).join(' and ')}, which the builder can't edit.`,
      )
      return
    }
    chartInitial = result.state
    chartTarget = { from: block.from, to: block.to }
    chartOpen = true
  }

  function commitChart(spec: string) {
    const block = '```vega-lite\n' + spec + '\n```'
    if (chartTarget) {
      // chartTarget is a raw offset pair captured when the builder opened and
      // never remapped against later document changes, so it cannot be
      // trusted blindly at commit time — guards elsewhere keep the document
      // still while the builder is open, but this is the safety net that
      // holds even if one of those guards is missing or a future change adds
      // a new way to edit the document. Re-check that the range still looks
      // like a vega-lite block before overwriting it.
      const current = editor.textInRange(chartTarget.from, chartTarget.to)
      if (!current.startsWith('```vega-lite') || !current.endsWith('```')) {
        toast("That chart moved while the builder was open, so it wasn't changed.")
        chartOpen = false
        chartInitial = null
        chartTarget = null
        return
      }
      editor.replaceRange(chartTarget.from, chartTarget.to, block)
    } else {
      editor.insertBlockAtCursor(block + '\n')
    }
    chartOpen = false
    chartInitial = null
    chartTarget = null
    // Every commit re-folds every vega-lite block in the document, including
    // ones the user had deliberately left unfolded — not just the block just
    // inserted or replaced.
    editor.runCommand(foldAllCodeBlocks)
  }

  let tableOpen = $state(false)
  let tableInitial: PipeTable | null = $state(null)
  let tableTarget: { from: number; to: number } | null = null
  // The exact text captured at the target range when the builder opened.
  // commitTable compares against this rather than merely re-parsing the live
  // range: parsePipeTable is deliberately lenient about trailing rows (it
  // treats any non-blank line after the delimiter as a data row, pipes or
  // not), so a stray edit that inserts a bogus row ahead of the table's own
  // rows — pushing the tail of the original block out of the stashed
  // [from, to) window — still parses "successfully" even though it is no
  // longer the table that was opened. An exact-text check catches that;
  // parsePipeTable alone would not.
  let tableOriginalText = ''

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
    tableOriginalText = block.text
    tableOpen = true
  }

  function closeTableBuilder() {
    tableOpen = false
    tableInitial = null
    tableTarget = null
    tableOriginalText = ''
  }

  function commitTable(table: PipeTable) {
    const text = serializePipeTable(table)
    if (tableTarget) {
      // Same safety net as commitChart: the range was captured when the
      // builder opened and is not remapped, so prove it still holds the same
      // table before overwriting it.
      const current = editor.textInRange(tableTarget.from, tableTarget.to)
      if (current !== tableOriginalText) {
        toast("That table moved while the builder was open, so it wasn't changed.")
        closeTableBuilder()
        return
      }
      editor.replaceRange(tableTarget.from, tableTarget.to, text)
    } else {
      // Unlike commitChart's fence, a GFM table does not terminate itself —
      // its last row keeps absorbing whatever text follows until a blank
      // line breaks it, so a plain trailing '\n' here would turn the next
      // paragraph into a bogus table row. Separate with a blank line, unless
      // one is already there (or there is nothing after the cursor at all),
      // in which case a bare '\n' avoids tripling up into two blank lines.
      const separator = editor.isFollowedByBlankLine() ? '\n' : '\n\n'
      editor.insertBlockAtCursor(text + separator)
    }
    closeTableBuilder()
  }

  function applyFormat(name: string) {
    // Menu accelerators fire regardless of focus, so a guard is required:
    // without it, Cmd-B on the welcome screen would edit a hidden document —
    // and, for the same reason, Cmd-B while the chart builder modal is open
    // would edit the document behind it.
    if (showWelcome || chartOpen || tableOpen) return
    const cmd = FORMAT_COMMANDS[name]
    if (cmd) editor.runCommand(cmd)
  }

  const FOLD_COMMANDS: Record<string, Command> = {
    'fold-block': foldCode,
    'unfold-block': unfoldCode,
    'fold-all-code': foldAllCodeBlocks,
    'unfold-all': unfoldAll,
  }

  function applyFold(name: string) {
    // Same guard as applyFormat: menu accelerators fire regardless of focus,
    // so without it a chord on the welcome screen — or with the chart
    // builder open — would act on a hidden document.
    if (showWelcome || chartOpen || tableOpen) return
    const cmd = FOLD_COMMANDS[name]
    if (cmd) editor.runCommand(cmd)
  }

  function insertCodeBlock(language: string) {
    // Same guard as applyFormat and applyFold: menu items fire regardless of
    // focus, so without it this would write into the hidden document behind
    // the welcome pane — or into the one behind the chart builder, which
    // cannot intercept an event arriving through Go's bus.
    if (showWelcome || chartOpen || tableOpen) return
    editor.insertCodeBlockAtCursor(language)
  }

  function onEditorChange(text: string) {
    content = text
    welcomeDismissed = true
    updatePreview(text)
  }

  // `cursor` is 'end' for a document created a moment ago, so typing starts
  // below its frontmatter; the 'start' default is for opening a file, which
  // must not relocate where ⌘⇧C and the Format-menu commands act.
  function loadDocument(docPath: string, docContent: string, cursor: 'start' | 'end' = 'start') {
    // Before anything changes: the keeper must not read the swap from a
    // dirty old document to a clean new one as a save of the old one.
    drafts.reset()
    draftWriteWarned = false
    // A swap makes any pending offer moot; the draft file stays on disk and
    // is offered again when that document is next opened.
    recovery = null
    path = docPath
    content = docContent
    welcomeDismissed = true
    editor.setContent(docContent, cursor) // fires onEditorChange, queueing a render
    savedContent = docContent
    // Render now rather than 250 ms from now, and drop the queued pass: it
    // would only re-render this same text.
    updatePreview.cancel()
    renderInto(docContent)
    void refreshRecents()
    void offerDraft(docPath)
  }

  // Asks Go whether a draft is worth offering for docPath ('' for untitled)
  // and raises the dialog if so. Go has already dropped a draft the file has
  // caught up with, so found means newer and different. A failure to ask is
  // logged, not shown: the cost is one missed offer.
  async function offerDraft(docPath: string) {
    try {
      const draft: Draft = await DocumentService.RecoverDraft(docPath)
      if (!draft.found) return
      // The document may have been swapped again while we waited.
      if ((path ?? '') !== docPath) return
      recovery = { key: docPath, content: draft.content }
    } catch (err) {
      console.warn('RecoverDraft:', err)
    }
  }

  function restoreDraft() {
    const draft = recovery
    recovery = null
    if (!draft) return
    // savedContent is left as the file's text (or '' for untitled), so the
    // restored document is dirty: nothing on disk holds this text yet. The
    // draft file itself stays until the next clean transition — it is still
    // the only copy.
    editor.setContent(draft.content, 'start') // fires onEditorChange, queueing a render
    content = draft.content
    welcomeDismissed = true
    updatePreview.cancel()
    renderInto(draft.content)
  }

  // Closes the dialog without touching the draft file: Esc (or any other
  // native dismissal) must not be destructive. The draft stays on disk and
  // is offered again the next time this document is opened, the same as a
  // document swap.
  function dismissRecovery() {
    recovery = null
    // A first launch with no recents goes to the template, as it would have
    // without a draft to ask about. Only the untitled path can be here with
    // an empty buffer.
    if (path === null && content === '' && recents.length === 0) doNew()
  }

  function discardRecoveredDraft() {
    // Captured before dismissRecovery clears `recovery`: the key the draft
    // was offered under, not the live path, which the first-launch
    // fallthrough below may already have moved on from.
    const key = recovery?.key ?? path ?? ''
    dismissRecovery()
    void DocumentService.DiscardDraft(key).catch((err) => console.warn('DiscardDraft:', err))
  }

  // The first-launch question, answered once. Both answers are stored, so
  // the dialog never comes back; Esc is "Don't Check" for the same reason.
  async function answerUpdateQuestion(answer: 'on' | 'off') {
    askUpdates = false
    try {
      const current: Settings = await DocumentService.Settings()
      await DocumentService.UpdateSettings({ ...current, updateCheck: answer })
    } catch (err) {
      toast(`Could not save the update-check setting: ${err}`)
      return
    }
    if (answer === 'on') void checkForUpdates(false)
  }

  // manual: Help → Check for Updates…, which ignores the daily throttle and
  // always reports. Automatic: at launch, which only speaks up when there is
  // something to say — an offline launch must not nag.
  async function checkForUpdates(manual: boolean) {
    if (manual && (chartOpen || tableOpen)) {
      toast('Finish or cancel the chart or table before checking for updates.')
      return
    }
    try {
      const result: UpdateResult = await DocumentService.CheckForUpdates(manual)
      if (result.available) {
        updateNotice = result
        return
      }
      if (manual) toast(`Hermes ${result.current} is up to date.`)
    } catch (err) {
      if (manual) toast(`Could not check for updates: ${err}`)
      else console.warn('CheckForUpdates:', err)
    }
  }

  function viewRelease() {
    const notice = updateNotice
    updateNotice = null
    if (notice) void Browser.OpenURL(notice.url)
  }

  async function refreshRecents() {
    recents = (await DocumentService.RecentFiles()) ?? []
  }

  async function refreshSettings() {
    const s: Settings = await DocumentService.Settings()
    syncScrolling = s.syncScrolling
    showOutline = s.showOutline
    autoSave = s.autoSave
    // Go clamps to the three values, so the cast is a spelling of what the
    // binding cannot express.
    updateCheck = s.updateCheck as UpdateCheckSetting
    spellCheck = s.spellCheck
    themeSetting = s.theme as ThemeSetting
    // Go normalises both on the way out, so the cast is a spelling of what
    // the binding cannot express rather than an unchecked assumption.
    chartWidth = s.chartWidth as ChartWidth
    figureAlign = s.figureAlignment as FigureAlignment
    paperSize = s.paperSize as PaperSize
    orientation = s.printOrientation as PageOrientation
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
    // menu:new fires regardless of focus (and regardless of whether the
    // chart builder modal is covering the editor), so this must refuse
    // rather than swap the whole document out from under an open modal.
    if (chartOpen || tableOpen || newOpen) return
    if (dirty) {
      pendingAction = 'new'
      return
    }
    newOpen = true
  }

  // File → New… is two prompts: this dialog (bibliography? which style?) and
  // then the native save panel. The order is forced by the frontmatter: the
  // live `bibliography:` key names a `.bib` after the document's own stem,
  // which is not known until the panel has been answered.
  let newOpen = $state(false)

  async function createDocument(bibliography: BibliographyChoice | null, csl: string) {
    newOpen = false
    try {
      const chosen = await DocumentService.ChooseNewDocumentPath()
      if (!chosen) return // cancelled
      // The frontmatter value and CreateDocument's bibName are the same
      // string: both resolve against the document, so what the document
      // says is exactly what gets created (or, for an existing file, found).
      // Only an existing file needs the document's folder to be known, which
      // is why this runs after the save panel rather than in the dialog.
      const { name: bibName, seed } = bibliographyFor(bibliography, chosen)
      const text = newDocumentText(bibName === '' ? null : bibName, csl)
      const doc = await DocumentService.CreateDocument(chosen, text, bibName, seed)
      loadDocument(doc.path, doc.content, 'end')
    } catch (err) {
      toast(`Could not create document: ${err}`)
    }
  }

  function bibliographyFor(
    choice: BibliographyChoice | null,
    docPath: string,
  ): { name: string; seed: string } {
    if (choice === null) return { name: '', seed: '' }
    switch (choice.kind) {
      case 'same': {
        const stem = docPath.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '')
        return { name: `${stem}.bib`, seed: BIBLIOGRAPHY_SEED }
      }
      case 'new':
        return { name: choice.name, seed: BIBLIOGRAPHY_SEED }
      case 'existing':
        // No seed: the file exists, and CreateDocument leaves an existing
        // file alone regardless.
        return { name: bibliographyReference(choice.path, docPath), seed: '' }
    }
  }

  // The first-launch scratch document: an untitled, templated buffer. Every
  // other route to a new document goes through createDocument above, which
  // saves and names the file first; this stays for the launch with nothing
  // to show, where a dialog before the window has even settled would be
  // hostile.
  function doNew() {
    drafts.reset()
    draftWriteWarned = false
    // A swap makes any pending offer moot; the draft file stays on disk and
    // is offered again when that document is next opened.
    recovery = null
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
    renderInto(NEW_DOCUMENT_TEMPLATE)
    welcomeDismissed = true
  }

  function requestOpen() {
    // Same reasoning as requestNew: menu:open must not swap the document out
    // from under an open chart builder modal, or the New… dialog.
    if (chartOpen || tableOpen || newOpen) return
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
    // Same reasoning as requestNew: menu- and welcome-pane-triggered opens
    // must not swap the document out from under an open chart builder modal,
    // or the New… dialog.
    if (chartOpen || tableOpen || newOpen) return
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
        // A rename starts a new document's one-toast-per-document guard;
        // the old path's failure (if any) says nothing about this one.
        draftWriteWarned = false
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
      // Same reasoning as the Save-As branch of save(): a new document
      // should not inherit a warning already shown for the old one.
      draftWriteWarned = false
      void refreshRecents()
    } catch (err) {
      toast(`Could not save: ${err}`)
    }
  }

  async function confirmSave() {
    // By the time save() resolves, the dirty effect has queued the draft's
    // discard, and finishPending's quit branch settles it.
    if (await save()) finishPending()
    else pendingAction = null
  }

  async function confirmDiscard() {
    savedContent = content // treat current text as accepted; clears dirty
    await DocumentService.SetDirty(false)
    // The dirty effect above has queued the draft's discard by now; a quit
    // that follows must not outrun it.
    await drafts.settle()
    finishPending()
  }

  function finishPending() {
    const action = pendingAction
    const recentPath = pendingRecentPath
    pendingAction = null
    pendingRecentPath = null
    if (action === 'quit') void drafts.settle().then(() => DocumentService.Quit())
    else if (action === 'new') newOpen = true
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
    Events.On('close:confirm', () => {
      // Mirrors the openChartBuilder guard above: don't raise the
      // unsaved-changes dialog behind the chart modal, which has no focus
      // trap of its own.
      //
      // Refuse, but audibly. This used to be a bare `return`, so ⌘Q with the
      // builder open did nothing whatsoever — the app looked frozen, and the
      // author had no way to tell a refusal from a bug. Refusing is still
      // right: the alternative, closing the builder to get at the dialog,
      // discards an in-progress chart to ask about a different document's
      // unsaved changes.
      if (chartOpen) {
        toast('Finish or cancel the chart before quitting.')
        return
      }
      if (tableOpen) {
        toast('Finish or cancel the table before quitting.')
        return
      }
      pendingAction = 'quit'
    })
    Events.On('recents:changed', () => void refreshRecents())
    Events.On('bib:changed', () => void reloadBibliography())
    Events.On('menu:insert-citation', () => void insertCitation())
    Events.On('menu:export-pdf', () => {
      void DocumentService.ExportPDF(path ?? '').catch((e) => toast(String(e)))
    })
    Events.On('menu:insert-chart', () => openChartBuilder())
    Events.On('menu:insert-table', () => openTableBuilder())
    Events.On('menu:insert-code', (ev: { data: unknown }) => {
      // '' is the Plain text item, and a legitimate payload — a bare fence.
      if (typeof ev.data === 'string') insertCodeBlock(ev.data)
    })
    Events.On('menu:format', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') applyFormat(ev.data)
    })
    Events.On('menu:fold', (ev: { data: unknown }) => {
      if (typeof ev.data === 'string') applyFold(ev.data)
    })
    Events.On('settings:changed', () => void refreshSettings())
    Events.On('menu:check-updates', () => void checkForUpdates(true))

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
      // A crash with an untitled document leaves a draft under the
      // 'untitled' key; this is the one moment it can be offered. The
      // dialog's Discard Draft falls through to the template below when
      // there are no recents; Restore replaces it.
      await offerDraft('')
      // A recovery offer is the more urgent dialog; the update question and
      // the automatic check wait for a launch with nothing else on screen.
      if (recovery !== null) return
      // A first launch has nothing to put in the welcome pane, so go straight
      // into a templated document rather than an empty one — the user who has
      // never seen Hermes is exactly the one the template is for.
      if (recents.length === 0) doNew()
      if (updateCheck === 'unasked') askUpdates = true
      else if (updateCheck === 'on') void checkForUpdates(false)
    })()

    return () => {
      media.removeEventListener('change', onSchemeChange)
      // App is the root component, so in production this runs only as the
      // process is going away — but a pending frame that outlives its
      // component is a leak the moment anything else unmounts it, and the
      // teardown it belongs in already exists.
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
    }
  })
</script>

<div class="app">
  <header class="toolbar">
    <button onclick={requestOpen}>Open</button>
    <button onclick={() => void save()}>Save</button>
    <button onclick={() => void insertCitation()}>Cite</button>
    <button onclick={openChartBuilder}>Chart</button>
    <button onclick={openTableBuilder}>Table</button>
    <button onclick={() => void DocumentService.ExportPDF(path ?? '').catch((e) => toast(String(e)))}>Export PDF</button>
  </header>

  <main class="panes">
    {#if showOutline}
      <Outline entries={outline} onjump={jumpToLine} onhide={() => void setOutlineShown(false)} />
    {:else}
      <button
        class="outline-arrow outline-reveal"
        onclick={() => void setOutlineShown(true)}
        title="Show outline (⌘⌥O)"
        aria-label="Show outline">›</button
      >
    {/if}
    <section class="editor-pane" style="width: {editorWidth}%">
      <Editor bind:this={editor} onchange={onEditorChange} onformat={applyFormat} onscroll={onEditorScroll} spellcheck={spellCheck} />
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
    <Preview bind:this={preview} {html} {figureAlign} {paperSize} {orientation} />
  </main>

  <footer class="status-bar">
    <span>{filename}{dirty ? ' •' : ''}</span>
  </footer>

  {#if showWelcome}
    <div class="welcome">
      <h2>Recent files</h2>
      <ul>
        {#each recents as r (r)}
          <li><button class="link-button" onclick={() => requestOpenRecent(r)}>{r}</button></li>
        {/each}
      </ul>
      <div class="welcome-actions">
        <button onclick={requestNew}>New document</button>
        <button onclick={requestOpen}>Open…</button>
      </div>
    </div>
  {/if}

  <!-- Both builders are placed ahead of NewDocument and the confirm Dialog
       below: those two are mounted unconditionally (they own visibility via
       their own `open` prop, not an {#if}), so their footer buttons —
       including ones labelled "Cancel" — are always present in the DOM.
       Putting the builders first means a plain `document.querySelectorAll`
       lookup (as the test helpers here do) finds the builder's own button
       first, matching what a user actually sees on top. -->
  {#if chartOpen}
    <ChartBuilder
      initial={chartInitial}
      oncommit={commitChart}
      oncancel={() => {
        chartOpen = false
        chartInitial = null
        chartTarget = null
      }}
    />
  {/if}

  {#if tableOpen}
    <TableBuilder initial={tableInitial} oncommit={commitTable} oncancel={closeTableBuilder} />
  {/if}

  <NewDocument open={newOpen} onclose={() => (newOpen = false)} oncreate={(b, c) => void createDocument(b, c)} />

  <Dialog
    open={pendingAction !== null}
    label="Unsaved changes"
    role="alertdialog"
    onclose={() => {
      pendingAction = null
      pendingRecentPath = null
    }}
  >
    <p>"{filename}" has unsaved changes.</p>
    {#snippet footer()}
      <button onclick={() => void confirmDiscard()}>Don't Save</button>
      <button
        onclick={() => {
          pendingAction = null
          pendingRecentPath = null
        }}>Cancel</button
      >
      <button class="primary" onclick={() => void confirmSave()}>Save</button>
    {/snippet}
  </Dialog>

  <Dialog
    open={recovery !== null}
    label="Recover draft"
    role="alertdialog"
    onclose={dismissRecovery}
  >
    {#if path === null}
      <p>An unsaved untitled document was recovered from the last session. Restore it?</p>
    {:else}
      <p>A draft of "{filename}" newer than the file on disk was found. Restore it?</p>
    {/if}
    {#snippet footer()}
      <button onclick={discardRecoveredDraft}>Discard Draft</button>
      <button class="primary" onclick={restoreDraft}>Restore</button>
    {/snippet}
  </Dialog>

  <Dialog open={askUpdates} label="Check for updates" onclose={() => void answerUpdateQuestion('off')}>
    <p>
      Hermes can fetch a small file from GitHub once a day to see whether a newer version exists.
      Nothing about you or your documents is sent. You can change this later in the Help menu.
    </p>
    {#snippet footer()}
      <button onclick={() => void answerUpdateQuestion('off')}>Don't Check</button>
      <button class="primary" onclick={() => void answerUpdateQuestion('on')}>Check Automatically</button>
    {/snippet}
  </Dialog>

  <Dialog open={updateNotice !== null} label="Update available" onclose={() => (updateNotice = null)}>
    {#if updateNotice}
      <p>Hermes {updateNotice.latest} is available. You have {updateNotice.current}.</p>
    {/if}
    {#snippet footer()}
      <button onclick={() => (updateNotice = null)}>Later</button>
      <button class="primary" onclick={viewRelease}>View Release</button>
    {/snippet}
  </Dialog>

  {#if toastMsg}
    <div class="toast" role="status">{toastMsg}</div>
  {/if}
</div>
