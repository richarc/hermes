<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView, basicSetup } from 'codemirror'
  import { markdown } from '@codemirror/lang-markdown'
  import { languages } from '@codemirror/language-data'
  import { keymap } from '@codemirror/view'
  import { Prec, type StateCommand } from '@codemirror/state'

  let {
    onchange,
    onformat,
  }: { onchange: (text: string) => void; onformat?: (name: string) => void } = $props()

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

  onMount(() => {
    view = new EditorView({
      parent: host,
      extensions: [
        stolenChords,
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
