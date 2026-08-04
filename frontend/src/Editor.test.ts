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
