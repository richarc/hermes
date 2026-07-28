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
