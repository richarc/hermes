<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView, basicSetup } from 'codemirror'
  import { markdown } from '@codemirror/lang-markdown'
  import { languages } from '@codemirror/language-data'
  import { keymap } from '@codemirror/view'
  import { Prec, type StateCommand } from '@codemirror/state'
  import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
  import { tags } from '@lezer/highlight'

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
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: cursor === 'end' ? text.length : 0 },
    })
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

  export function runCommand(cmd: StateCommand): void {
    cmd({ state: view.state, dispatch: (tr) => view.dispatch(tr) })
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

  onMount(() => {
    view = new EditorView({
      parent: host,
      extensions: [
        stolenChords,
        basicSetup,
        hermesTheme,
        syntaxHighlighting(hermesHighlight),
        markdown({ codeLanguages: languages }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onchange(u.state.doc.toString())
        }),
      ],
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
