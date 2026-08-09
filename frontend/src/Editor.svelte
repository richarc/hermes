<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView, basicSetup } from 'codemirror'
  import { markdown } from '@codemirror/lang-markdown'
  import { languages } from '@codemirror/language-data'
  import { keymap, type Command } from '@codemirror/view'
  import { EditorState, Prec } from '@codemirror/state'
  import { HighlightStyle, syntaxHighlighting, syntaxTree, forceParsing } from '@codemirror/language'
  import { tags } from '@lezer/highlight'
  import type { SyntaxNode } from '@lezer/common'
  import { codeHighlightStyleSpecs } from './lib/syntaxTags'

  let {
    onchange,
    onformat,
    onscroll,
  }: {
    onchange: (text: string) => void
    onformat?: (name: string) => void
    onscroll?: () => void
  } = $props()

  // Menu accelerators normally win, because AppKit dispatches them before the
  // webview — but not for chords CodeMirror's defaultKeymap already claims with
  // preventDefault. basicSetup binds Mod-i (selectParentSyntax) and Shift-Mod-k
  // (deleteLine), so those two never reach menu.go and must be caught here.
  // Routed through onformat rather than the commands directly, so the welcome
  // screen guard in App.svelte stays the single decision point.
  const stolenChords = Prec.highest(
    keymap.of([
      {
        key: 'Mod-i',
        run: () => {
          if (!onformat) return false
          onformat('italic')
          return true
        },
      },
      {
        key: 'Mod-Shift-k',
        run: () => {
          if (!onformat) return false
          onformat('code')
          return true
        },
      },
    ]),
  )

  // Every colour is a CSS variable, so switching the app theme restyles the
  // editor with no reconfiguration — no Compartment, no dispatch, nothing to
  // get out of step. Verified: var() survives into the stylesheet CodeMirror
  // generates, and our rules are emitted after the base theme's, which is what
  // wins the specificity tie. `dark: true` is deliberately omitted; it only
  // adds a class for base `&dark` rules, all of which we override below.
  //
  // The win over the base theme is a precedence guarantee, not accidental
  // source order: EditorView.baseTheme wraps its style module in Prec.lowest,
  // and mountStyles mounts base themes first by contract, so an ordinary
  // EditorView.theme() like this one always lands after it. `&light` also
  // does not compile to a single class — e.g. `.ͼ2 .cm-selectionBackground`,
  // two classes, same as ours — so the two have equal specificity and this
  // precedence guarantee is what decides the tie, not source order per se.
  //
  // The live residual risk is not a future CodeMirror raising base-theme
  // specificity; the precedence guarantee makes that a non-issue. It is a
  // future extension listed after hermesTheme below that itself calls
  // EditorView.theme() — that would land after ours at equal precedence and
  // win. None of today's extensions do; watch for it if one is added.
  const hermesTheme = EditorView.theme({
    '&': { backgroundColor: 'var(--editor-bg)', color: 'var(--editor-fg)' },
    '.cm-content': { caretColor: 'var(--editor-caret)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--editor-caret)' },
    '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
      { backgroundColor: 'var(--editor-selection)' },
    '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-gutter-bg)',
      color: 'var(--editor-gutter-fg)',
      border: 'none',
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)' },
    // basicSetup's searchKeymap self-installs a find/replace panel on ⌘F, and
    // nothing intercepts that chord ahead of CodeMirror (Wails' Edit menu role
    // has no Find item), so the panel and its controls need the same var()
    // treatment as the document — otherwise they stay on the base theme's
    // `&light` rules and read as a light bar pinned to a dark editor.
    '.cm-panels': { backgroundColor: 'var(--editor-gutter-bg)', color: 'var(--editor-fg)' },
    '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
    '.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
    '.cm-textfield': {
      backgroundColor: 'var(--editor-bg)',
      color: 'var(--editor-fg)',
      border: '1px solid var(--border-strong)',
    },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'var(--editor-gutter-bg)',
      color: 'var(--editor-fg)',
      border: '1px solid var(--border-strong)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--editor-gutter-bg)',
      color: 'var(--editor-fg)',
      border: '1px solid var(--border)',
    },
    '.cm-specialChar': { color: 'var(--editor-gutter-fg)' },
    // CodeMirror's base theme hardcodes this pill as #eee on #ddd with #888
    // text — a light chip on a dark page. Same class of gap as the search
    // panel: a base rule the theme has to override to follow the palette.
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      color: 'var(--muted)',
    },
  })

  // Markdown highlighting is modest by design — this is a writing tool.
  const hermesHighlight = HighlightStyle.define([
    { tag: tags.heading, color: 'var(--syn-heading)', fontWeight: 'bold' },
    { tag: tags.emphasis, color: 'var(--syn-emphasis)', fontStyle: 'italic' },
    { tag: tags.strong, color: 'var(--syn-emphasis)', fontWeight: 'bold' },
    { tag: tags.monospace, color: 'var(--syn-code)' },
    { tag: tags.link, color: 'var(--syn-link)' },
    { tag: tags.url, color: 'var(--syn-link)' },
    { tag: tags.quote, color: 'var(--syn-quote)' },
    { tag: tags.meta, color: 'var(--syn-meta)' },
    // Code tokens, from the table both panes share. Comments arrive through
    // it too, carrying the --syn-meta colour above.
    ...codeHighlightStyleSpecs(),
  ])

  let host: HTMLElement
  let view: EditorView

  // The two callers need different cursor placement, not one compromise:
  // File → New wants the cursor at the end so typing continues below the
  // frontmatter, but opening an existing file must leave it at the start —
  // anywhere else silently relocates where ⌘⇧C and the Format-menu commands
  // act on a freshly opened document. Do not "simplify" this back to one
  // behaviour; 'start' is also the default so every other/future caller gets
  // the safe behaviour without having to know about this distinction.
  export function setContent(text: string, cursor: 'start' | 'end' = 'start'): void {
    // A fresh state, not a transaction. basicSetup bundles history(), so
    // dispatching the replacement left it sitting on the undo stack: ⌘Z after
    // File → New restored the PREVIOUS document's text while App.svelte's
    // `path` was already null, and the next ⌘S wrote that old content into a
    // brand new file. A new state has no history to undo into — which is the
    // honest model regardless, since this is a different document rather than
    // an edit to the current one. It also discards the scroll position and
    // any open find panel, both of which belonged to the old document.
    view.setState(
      EditorState.create({
        doc: text,
        selection: { anchor: cursor === 'end' ? text.length : 0 },
        extensions: editorExtensions(),
      }),
    )
    // setState swaps the state wholesale instead of applying a transaction,
    // so the updateListener never sees docChanged and no caller would learn
    // the document had changed. Report it here instead.
    onchange(text)
    // Only the end-of-document placement (File → New) should steal focus:
    // that is the path where the user is about to type. Opening a file must
    // not steal focus, since that is not current behaviour and was not asked
    // for.
    if (cursor === 'end') view.focus()
  }

  export function insertAtCursor(text: string): void {
    view.dispatch(view.state.replaceSelection(text))
    view.focus()
  }

  /**
   * Inserts text as its own block, guaranteeing it starts on a fresh line.
   *
   * insertAtCursor is deliberately raw — a citation belongs mid-sentence. A
   * fenced block does not: written at a column other than 0 it is not a fence
   * at all, markdown renders its contents as prose, and the syntax tree will
   * not recognise it, so the builder cannot reopen what it just wrote.
   */
  export function insertBlockAtCursor(text: string): void {
    const from = view.state.selection.main.from
    const line = view.state.doc.lineAt(from)
    const prefix = from === line.from ? '' : '\n\n'
    view.dispatch(view.state.replaceSelection(prefix + text))
    view.focus()
  }

  /**
   * Runs an editor command. Typed `Command` rather than `StateCommand` because
   * CodeMirror's fold commands need the view — and a `StateCommand` works when
   * handed a view too, so this one signature serves both kinds.
   */
  export function runCommand(cmd: Command): void {
    cmd(view)
    view.focus()
  }

  /** Total lines in the document, for mapping against the preview's extent. */
  export function lineCount(): number {
    return view.state.doc.lines
  }

  /**
   * The 1-based line at the top of the visible editor area.
   *
   * Resolved through posAtCoords at the scroller's top-left corner rather than
   * arithmetic on scrollTop, which keeps everything in one coordinate space
   * instead of reconciling documentTop against documentPadding. A null result
   * means the point is outside the content — treat that as the top.
   */
  export function topVisibleLine(): number {
    const rect = view.scrollDOM.getBoundingClientRect()
    const pos = view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 })
    if (pos == null) return 1
    return view.state.doc.lineAt(pos).number
  }

  export interface ChartBlock {
    from: number
    to: number
    spec: string
  }

  /**
   * The `vega-lite` fenced block containing the cursor, or null.
   *
   * Two things here are load-bearing and were established by measurement:
   *
   * 1. forceParsing first. CodeMirror parses only the first ~3000 characters
   *    synchronously, so a chart late in a long paper is invisible to the tree
   *    until parsing is forced — the same trap that made late fences fail to
   *    fold in v0.5.
   * 2. Both sides. resolveInner(pos, 0) misses BOTH the exact start of the
   *    opening fence and the exact end of the closing fence, and each is an
   *    ordinary place to leave a cursor. side=1 reaches the first, side=-1 the
   *    second, so try them in that order.
   */
  export function enclosingChartBlock(): ChartBlock | null {
    forceParsing(view, view.state.doc.length, 5000)
    const tree = syntaxTree(view.state)
    const pos = view.state.selection.main.head

    for (const side of [1, -1] as const) {
      let node: SyntaxNode | null = tree.resolveInner(pos, side)
      while (node && node.name !== 'FencedCode') node = node.parent
      if (!node) continue

      let info = ''
      let bodyFrom = -1
      let bodyTo = -1
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.name === 'CodeInfo') info = view.state.doc.sliceString(c.from, c.to)
        // An empty block has no CodeText child at all, hence the -1 default.
        if (c.name === 'CodeText') {
          bodyFrom = c.from
          bodyTo = c.to
        }
      }
      if (info.trim() !== 'vega-lite') continue

      return {
        from: node.from,
        to: node.to,
        spec: bodyFrom >= 0 ? view.state.doc.sliceString(bodyFrom, bodyTo) : '',
      }
    }
    return null
  }

  /**
   * The document text between two positions, or '' if the range does not fit
   * inside the current document. Callers use the empty result as "this range
   * is no longer meaningful" rather than risking an out-of-bounds exception —
   * a range captured before the document changed underneath it (e.g. a chart
   * block's position, stashed while a modal was open) cannot be trusted to
   * still be in bounds.
   */
  export function textInRange(from: number, to: number): string {
    const len = view.state.doc.length
    if (from < 0 || to > len || from > to) return ''
    return view.state.doc.sliceString(from, to)
  }

  /** Replaces a document range, leaving the cursor after the inserted text. */
  export function replaceRange(from: number, to: number, text: string): void {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    })
    view.focus()
  }

  /**
   * The editor's full extension set.
   *
   * A function rather than an inline array because `setContent` rebuilds the
   * state from scratch to drop the undo history, and needs the same
   * extensions to build it with.
   */
  function editorExtensions() {
    return [
      stolenChords,
      basicSetup,
      hermesTheme,
      syntaxHighlighting(hermesHighlight),
      markdown({ codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onchange(u.state.doc.toString())
      }),
    ]
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      extensions: editorExtensions(),
    })
    const onScrollDOM = () => onscroll?.()
    view.scrollDOM.addEventListener('scroll', onScrollDOM, { passive: true })
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScrollDOM)
      view.destroy()
    }
  })
</script>

<div class="editor-host" bind:this={host}></div>
