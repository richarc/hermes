// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ensureSyntaxTree, forceParsing } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { Table } from '@lezer/markdown'
import { protectedRanges, spellcheckExtension } from './spellcheck'

function state(doc: string): EditorState {
  const s = EditorState.create({ doc, extensions: [markdown({ extensions: [Table] })] })
  // The language parses lazily; the tests need the whole tree.
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}

/** The protected substrings of doc, in order, for readable assertions. */
function protectedText(doc: string): string[] {
  const s = state(doc)
  return protectedRanges(s, 0, s.doc.length).map((r) => doc.slice(r.from, r.to))
}

describe('protectedRanges', () => {
  it('leaves plain prose alone', () => {
    expect(protectedText('Some prose with a misspeling in it.\n')).toEqual([])
  })

  it('protects fenced and inline code', () => {
    const doc = 'Prose.\n\n```js\nconst x = 1\n```\n\nUse `foo()` here.\n'
    expect(protectedText(doc)).toEqual(['```js\nconst x = 1\n```', '`foo()`'])
  })

  it('protects indented code blocks', () => {
    const doc = 'Prose.\n\n    indented code\n\nMore prose.\n'
    // The CodeBlock node's range covers the content only, not the leading
    // 4-space indent marker (confirmed via syntaxTree(state).toString()) —
    // same shape as the FencedCode/HTML delimiter quirks noted below.
    expect(protectedText(doc)).toEqual(['indented code'])
  })

  it('protects frontmatter by line', () => {
    const doc = '---\ntitle: Hello\nbibliography: refs.bib\n---\n\nProse.\n'
    expect(protectedText(doc)).toEqual(['---\ntitle: Hello\nbibliography: refs.bib\n---'])
  })

  it('does not treat an unterminated leading --- as frontmatter', () => {
    expect(protectedText('---\nnot closed\n\nProse.\n')).toEqual([])
  })

  it('protects link destinations but not link text', () => {
    const doc = 'See [the docs](https://example.com/pth) and <https://x.org>.\n'
    expect(protectedText(doc)).toEqual(['https://example.com/pth', '<https://x.org>'])
  })

  it('protects HTML', () => {
    const doc = 'Prose <span class="x">inline</span> here.\n\n<div>\nblock\n</div>\n'
    const got = protectedText(doc)
    expect(got).toContain('<span class="x">')
    expect(got).toContain('</span>')
    expect(got.some((t) => t.startsWith('<div>'))).toBe(true)
  })

  it('protects inline and display maths', () => {
    const doc = 'Let $x^2 + y^2$ be given.\n\n$$\n\\int_0^1 f(x)\\,dx\n$$\n\nDone.\n'
    expect(protectedText(doc)).toEqual(['$x^2 + y^2$', '$$\n\\int_0^1 f(x)\\,dx\n$$'])
  })

  it('protects citations, bracketed and bare', () => {
    const doc = 'As shown [@smith2020, p. 3; @doe2021] and by @lee2019 too.\n'
    expect(protectedText(doc)).toEqual(['[@smith2020, p. 3; @doe2021]', '@lee2019'])
  })

  it('does not protect an email-like address as a citation', () => {
    // A bare @ must start a token: "a@b" is not a citation key.
    expect(protectedText('Write to me a@b.org please.\n')).toEqual([])
  })

  it('merges overlapping regions and clips to the window', () => {
    const doc = 'Prose `code with $math$ inside` and $x$.\n'
    const s = state(doc)
    // Whole doc: the inline code swallows the maths inside it.
    expect(protectedRanges(s, 0, s.doc.length).map((r) => doc.slice(r.from, r.to))).toEqual([
      '`code with $math$ inside`',
      '$x$',
    ])
    // A window ending mid-code clips the range rather than dropping it.
    const codeStart = doc.indexOf('`')
    const clipped = protectedRanges(s, 0, codeStart + 5)
    expect(clipped).toEqual([{ from: codeStart, to: codeStart + 5 }])
  })

  it('returns sorted, non-overlapping ranges', () => {
    const doc = '$a$ `b` [@c] <d>e</d> $$f$$\n'
    const s = state(doc)
    const got = protectedRanges(s, 0, s.doc.length)
    for (let i = 1; i < got.length; i++) expect(got[i].from).toBeGreaterThanOrEqual(got[i - 1].to)
  })
})

describe('spellcheckExtension', () => {
  function mountView(doc: string, extensions: Extension[]) {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({ parent, state: EditorState.create({ doc, extensions }) })
    return { view, cleanup: () => { view.destroy(); parent.remove() } }
  }

  it('sets spellcheck="true" on the content element and marks protected text false', () => {
    const { view, cleanup } = mountView('Prose `code` and $x$.\n', [
      markdown({ extensions: [Table] }),
      spellcheckExtension(),
    ])
    forceParsing(view)
    expect(view.contentDOM.getAttribute('spellcheck')).toBe('true')
    const off = [...view.contentDOM.querySelectorAll('[spellcheck="false"]')].map((el) => el.textContent)
    expect(off).toEqual(['`code`', '$x$'])
    cleanup()
  })

  it("leaves CodeMirror's default (off) without the extension", () => {
    const { view, cleanup } = mountView('x', [])
    expect(view.contentDOM.getAttribute('spellcheck')).toBe('false')
    cleanup()
  })
})
