// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import { EditorView, type Command } from '@codemirror/view'
import { foldCode } from '@codemirror/language'
import Editor from './Editor.svelte'
import { toggleBold } from './lib/markdownCommands'

interface ChartBlock {
  from: number
  to: number
  spec: string
}

interface EditorApi {
  setContent(text: string, cursor?: 'start' | 'end'): void
  insertAtCursor(text: string): void
  insertBlockAtCursor(text: string): void
  runCommand(cmd: Command): void
  lineCount(): number
  topVisibleLine(): number
  enclosingChartBlock(): ChartBlock | null
  replaceRange(from: number, to: number, text: string): void
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

describe('Editor.insertBlockAtCursor', () => {
  // Critical finding: commitChart used insertAtCursor (a bare
  // replaceSelection) for a fresh insert, so a chart placed after prose on
  // the same line landed mid-line — not a fence at all, so markdown rendered
  // the raw JSON as prose and the syntax tree could never recognise it well
  // enough to reopen. insertBlockAtCursor exists specifically to guarantee a
  // fresh line.
  it('starts the block on a fresh line when the cursor is mid-line, leaving the original prose intact', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('Some prose here.', 'end')
    flushSync()

    editor.insertBlockAtCursor('```vega-lite\n{}\n```')
    flushSync()

    const doc = text()
    expect(doc).toMatch(/(^|\n)```vega-lite/)
    // The original sentence survives whole, on its own line, not merged
    // into the fence.
    const lines = doc.split('\n')
    expect(lines[0]).toBe('Some prose here.')
    cleanup()
  })

  it('does not add a spurious blank line when the cursor is already at column 0', () => {
    const { editor, text, cleanup } = mountEditor()
    editor.setContent('') // cursor defaults to the start
    flushSync()

    editor.insertBlockAtCursor('```vega-lite\n{}\n```')
    flushSync()

    expect(text()).toBe('```vega-lite\n{}\n```')
    cleanup()
  })

  // Residual of the same critical bug: replaceSelection inserts at the
  // selection's `from`, not its `head`. A forward selection (anchor < head)
  // that starts mid-line but ends at the next line's column 0 has a head
  // that reads as "column 0" even though the insertion itself lands mid-line
  // — so a head-keyed check let the fence merge into the prose exactly as
  // before, just for selections instead of plain cursors. Keying off `from`
  // fixes it.
  it('keys off the selection start, not its head, for a forward selection reaching the next line', () => {
    const { editor, target, text, cleanup } = mountEditor()
    editor.setContent('Just prose.\nsecond line\n')
    flushSync()

    const view = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    const from = 'Just prose.'.length // right after the period — mid-line
    // Forward selection: anchor at `from` (mid-line), head at the start of
    // the next line. main.head would read as column 0; main.from does not.
    view.dispatch({ selection: { anchor: from, head: from + 1 } })
    flushSync()

    editor.insertBlockAtCursor('```vega-lite\n{}\n```\n')
    flushSync()

    const doc = text()
    expect(doc).toMatch(/(^|\n)```vega-lite/)
    // The original sentence survives whole, on its own line, not merged
    // into the fence.
    expect(doc.split('\n')[0]).toBe('Just prose.')
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

  it('themes the search/replace panel that ⌘F opens, not just the document', () => {
    // basicSetup's searchKeymap self-installs a panel (.cm-panels, with a
    // .cm-textfield and .cm-button inside it) that nothing else intercepts,
    // so it must follow the palette like every other editor rule instead of
    // staying on CodeMirror's light base theme.
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    expect(css).toMatch(/\.cm-panels\s*\{[^}]*var\(--/)
    expect(css).toMatch(/\.cm-textfield\s*\{[^}]*var\(--/)

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

describe('Editor folding', () => {
  it('themes the folded placeholder from the palette', () => {
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    // CodeMirror's base theme hardcodes #eee/#ddd/#888 here, which is a light
    // pill on a dark page. Ours must come from the palette instead.
    expect(css).toMatch(/\.cm-foldPlaceholder[^}]*var\(--/)

    cleanup()
  })
})

describe('Editor.runCommand', () => {
  it('runs a StateCommand (toggleBold) through the mounted view', () => {
    // markdownCommands.test.ts calls toggleBold with a hand-built
    // {state, dispatch} pair, never through Editor.svelte — it proves the
    // command works in isolation, not that runCommand's `cmd(view)` call
    // still drives a StateCommand correctly. This exercises that path for
    // real: EditorView.findFromDOM gets the actual view instance so we can
    // select "hello" the way a user would, then runCommand invokes toggleBold
    // with the view itself, exactly as App.svelte does.
    const { target, editor, text, cleanup } = mountEditor()
    editor.setContent('hello')
    flushSync()

    const view = EditorView.findFromDOM(target)
    expect(view).not.toBeNull()
    view?.dispatch({ selection: { anchor: 0, head: 5 } })

    editor.runCommand(toggleBold)
    flushSync()

    expect(text()).toBe('**hello**')
    cleanup()
  })

  it('runs a view-taking Command (foldCode) through the same method', () => {
    // The other half of the widening: CodeMirror's fold commands are typed
    // Command, not StateCommand, and need the view rather than a
    // {state, dispatch} pair. A folded block renders a .cm-foldPlaceholder
    // element, so its presence proves runCommand drove foldCode correctly.
    const { target, editor, cleanup } = mountEditor()
    editor.setContent('```js\nconst x = 1\n```\n')
    flushSync() // cursor defaults to the document start, on the fence's opening line

    editor.runCommand(foldCode)
    flushSync()

    expect(target.querySelector('.cm-foldPlaceholder')).not.toBeNull()
    cleanup()
  })
})

describe('chart block lookup', () => {
  const DOC = [
    '# Results',
    '',
    '```vega-lite',
    '{"mark": "line"}',
    '```',
    '',
    'After.',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
  ].join('\n')

  /** Mounts with DOC loaded and the cursor at `pos`. */
  function atPosition(pos: number) {
    const { editor, cleanup } = mountEditor()
    editor.setContent(DOC)
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: pos } })
    return { editor, view, cleanup }
  }

  it('finds the block when the cursor is in the spec body', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('"mark"'))
    const block = editor.enclosingChartBlock()
    expect(block).not.toBeNull()
    expect(block!.spec).toBe('{"mark": "line"}')
    cleanup()
  })

  it('finds the block from the very start of the opening fence', () => {
    // side=0 misses this position entirely; the implementation tries side=1.
    const { editor, cleanup } = atPosition(DOC.indexOf('```vega-lite'))
    expect(editor.enclosingChartBlock()).not.toBeNull()
    cleanup()
  })

  it('finds the block from the end of the closing fence', () => {
    // The mirror case: only side=-1 reaches this one.
    const end = DOC.indexOf('```\n\nAfter') + 3
    const { editor, cleanup } = atPosition(end)
    expect(editor.enclosingChartBlock()).not.toBeNull()
    cleanup()
  })

  it('returns null in ordinary prose', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('After.') + 2)
    expect(editor.enclosingChartBlock()).toBeNull()
    cleanup()
  })

  it('returns null inside a non-vega fenced block', () => {
    const { editor, cleanup } = atPosition(DOC.indexOf('const x'))
    expect(editor.enclosingChartBlock()).toBeNull()
    cleanup()
  })

  it('reports an empty body for an empty chart block', () => {
    const { editor, cleanup } = mountEditor()
    editor.setContent('```vega-lite\n```\n')
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: 13 } })
    expect(editor.enclosingChartBlock()!.spec).toBe('')
    cleanup()
  })

  it('replaces a range and leaves the cursor after the new text', () => {
    const { editor, view, cleanup } = atPosition(0)
    const block = (() => {
      view.dispatch({ selection: { anchor: DOC.indexOf('"mark"') } })
      return editor.enclosingChartBlock()!
    })()
    editor.replaceRange(block.from, block.to, '```vega-lite\n{"mark": "bar"}\n```')
    expect(view.state.doc.toString()).toContain('"mark": "bar"')
    expect(view.state.doc.toString()).not.toContain('"mark": "line"')
    expect(view.state.selection.main.head).toBe(block.from + 32)
    cleanup()
  })
})
