// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import Editor from './Editor.svelte'

interface EditorApi {
  setContent(text: string, cursor?: 'start' | 'end'): void
  insertAtCursor(text: string): void
  lineCount(): number
  topVisibleLine(): number
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
  it('defaults the cursor to the start, so opening a file does not relocate it', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('---\n# csl: apa\n---\n')
    flushSync()

    editor.insertAtCursor('BODY')
    flushSync()

    expect(text()).toBe('BODY---\n# csl: apa\n---\n')
    cleanup()
  })

  it("leaves the cursor at the end when asked, so typing after File → New continues below the text", () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('---\n# csl: apa\n---\n', 'end')
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

describe('Editor scroll reporting', () => {
  it('reports the document line count', () => {
    const { editor, cleanup } = mountEditor()
    editor.setContent('a\nb\nc\nd\n')
    flushSync()
    expect(editor.lineCount()).toBe(5) // four lines plus the trailing empty one
    cleanup()
  })

  it('calls onscroll when the editor scroller scrolls', () => {
    const scrolls: number[] = []
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(Editor, {
      target,
      props: { onchange: () => {}, onscroll: () => scrolls.push(1) },
    }) as unknown as { setContent(t: string): void }
    flushSync()

    const scroller = target.querySelector('.cm-scroller') as HTMLElement
    scroller.dispatchEvent(new Event('scroll'))
    expect(scrolls.length).toBe(1)

    unmount(cmp as never)
  })
})

describe('Editor theme', () => {
  it('styles itself with CSS variables, never literal colours', () => {
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    // Our theme's rules — the ones carrying var(--editor-*) — must exist.
    expect(css).toContain('var(--editor-bg)')
    expect(css).toContain('var(--editor-selection)')
    expect(css).toContain('var(--editor-gutter-bg)')
    expect(css).toContain('var(--syn-heading)')

    cleanup()
  })

  it('emits our theme after the base theme, so ours wins the specificity tie', () => {
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    const lines = css.split('\n')
    const base = lines.findIndex((l) => /\.\S+ \.cm-selectionBackground \{background: #/.test(l))
    const ours = lines.findIndex((l) => l.includes('var(--editor-selection)'))
    // CodeMirror's `&light` base rule and ours have equal specificity — one
    // class each — so source order decides. If a future CodeMirror raised base
    // specificity this would break, and the symptom would be a light selection
    // highlight in dark mode rather than an error.
    expect(base).toBeGreaterThanOrEqual(0)
    expect(ours).toBeGreaterThan(base)

    cleanup()
  })
})
