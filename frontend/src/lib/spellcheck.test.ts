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

  it('does not pair a $$ inside inline code with a real display block', () => {
    // The preview's blockMath rule only opens on a $$ at the start of a
    // line, so the $$ inside the inline-code span must not pair with the
    // real block below it and silence the prose paragraph in between.
    const doc = 'Use `$$` in bash.\n\nSome prose with a misspeling here.\n\n$$\nE = mc^2\n$$\n\nMore prose.\n'
    expect(protectedText(doc)).toEqual(['`$$`', '$$\nE = mc^2\n$$'])
  })

  it('does not treat currency as inline maths', () => {
    // The preview's isValidInlineDelim rejects an opening $ preceded by a
    // word/digit character and a closing $ followed by one, so these are
    // rendered as prose, not maths.
    expect(protectedText('The widget costs $5 and the gadgit costs $10 later.\n')).toEqual([])
    expect(protectedText('Prices are $5, $10 and $20 in the tabel.\n')).toEqual([])
  })

  it('still protects genuine inline maths and a stray dollar sign', () => {
    expect(protectedText('Mid-sentence $x^2 + y^2$ maths.\n')).toEqual(['$x^2 + y^2$'])
    expect(protectedText('a stray $ sign here and another $ sign\n')).toEqual(['$ sign here and another $'])
  })

  it('protects citations, bracketed and bare', () => {
    const doc = 'As shown [@smith2020, p. 3; @doe2021] and by @lee2019 too.\n'
    expect(protectedText(doc)).toEqual(['[@smith2020, p. 3; @doe2021]', '@lee2019'])
  })

  it('does not protect an email-like address as a citation', () => {
    // A bare @ must start a token: "a@b" is not a citation key.
    expect(protectedText('Write to me a@b.org please.\n')).toEqual([])
  })

  it('does not let a bracketed citation group cross lines', () => {
    const doc = 'I typed [@smith2020 and then a [link](http://x.org) plus a misspeling.\n'
    expect(protectedText(doc)).toEqual(['http://x.org'])
  })

  it('does not swallow the full stop after a bare citation', () => {
    expect(protectedText('See @smith2020. Then more.\n')).toEqual(['@smith2020'])
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

  it('splits a multi-line protected range into one span per line', () => {
    // CodeMirror renders a Decoration.mark that crosses a line break as a
    // separate span per line, so a three-line display-maths block becomes
    // three [spellcheck="false"] spans, not one spanning the newlines.
    const { view, cleanup } = mountView('$$\nE = mc^2\n$$\n', [
      markdown({ extensions: [Table] }),
      spellcheckExtension(),
    ])
    forceParsing(view)
    const off = [...view.contentDOM.querySelectorAll('[spellcheck="false"]')].map((el) => el.textContent)
    expect(off).toEqual(['$$', 'E = mc^2', '$$'])
    cleanup()
  })

  it("leaves CodeMirror's default (off) without the extension", () => {
    const { view, cleanup } = mountView('x', [])
    expect(view.contentDOM.getAttribute('spellcheck')).toBe('false')
    cleanup()
  })
})
