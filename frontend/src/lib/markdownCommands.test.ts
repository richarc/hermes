import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { isProtected } from './markdownCommands'

function stateOf(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdown()] })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

describe('isProtected', () => {
  it('protects text inside a fenced code block', () => {
    const doc = 'Text\n\n```vega-lite\n{"mark": "bar"}\n```\n'
    expect(isProtected(stateOf(doc), doc.indexOf('"mark"'))).toBe(true)
  })

  it('protects inline code', () => {
    const doc = 'Run `npm test` now'
    expect(isProtected(stateOf(doc), doc.indexOf('npm'))).toBe(true)
  })

  it('protects the frontmatter block including its fences', () => {
    const doc = '---\nbibliography: refs.bib\n---\n# Title'
    const state = stateOf(doc)
    expect(isProtected(state, 0)).toBe(true)
    expect(isProtected(state, doc.indexOf('bibliography'))).toBe(true)
  })

  it('leaves ordinary prose alone', () => {
    const doc = '---\nbibliography: refs.bib\n---\n# Title\n\nProse here.'
    expect(isProtected(stateOf(doc), doc.indexOf('Prose'))).toBe(false)
  })

  it('does not treat a mid-document --- as frontmatter', () => {
    const doc = 'Intro\n\n---\n\nMore text'
    expect(isProtected(stateOf(doc), doc.indexOf('More'))).toBe(false)
  })

  it('does not treat an unterminated leading --- as frontmatter', () => {
    const doc = '---\nnot closed\n\ntext'
    expect(isProtected(stateOf(doc), doc.indexOf('text'))).toBe(false)
  })
})

import { EditorSelection, type StateCommand } from '@codemirror/state'
import {
  toggleHeading,
  toggleBulletList,
  toggleOrderedList,
  toggleBlockquote,
} from './markdownCommands'

function run(cmd: StateCommand, doc: string, from = 0, to = from): string {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: [markdown()],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  let next = state
  cmd({ state, dispatch: (tr) => (next = tr.state) })
  return next.doc.toString()
}

describe('toggleHeading', () => {
  it('makes the cursor line a heading', () => {
    expect(run(toggleHeading(2), 'Some line', 2)).toBe('## Some line')
  })

  it('removes the heading when the line already has that level', () => {
    expect(run(toggleHeading(2), '## Some line', 4)).toBe('Some line')
  })

  it('replaces a different level instead of stacking markers', () => {
    expect(run(toggleHeading(2), '### Some line', 5)).toBe('## Some line')
  })

  it('replaces a list marker rather than combining the two', () => {
    expect(run(toggleHeading(1), '- an item', 3)).toBe('# an item')
  })

  it('level 0 removes any heading', () => {
    expect(run(toggleHeading(0), '#### Deep', 6)).toBe('Deep')
  })

  it('applies to every line of a multi-line selection', () => {
    const doc = 'one\ntwo'
    expect(run(toggleHeading(1), doc, 0, doc.length)).toBe('# one\n# two')
  })

  it('removes only when every selected line already has that level', () => {
    const doc = '# one\n# two'
    expect(run(toggleHeading(1), doc, 0, doc.length)).toBe('one\ntwo')
  })

  it('applies to all when the selection is mixed', () => {
    const doc = '# one\ntwo'
    expect(run(toggleHeading(1), doc, 0, doc.length)).toBe('# one\n# two')
  })

  it('refuses to touch a fenced code block', () => {
    const doc = '```\ncode line\n```'
    expect(run(toggleHeading(1), doc, doc.indexOf('code'))).toBe(doc)
  })

  it('refuses to touch frontmatter', () => {
    const doc = '---\nbibliography: refs.bib\n---\n# T'
    expect(run(toggleHeading(1), doc, doc.indexOf('bibliography'))).toBe(doc)
  })
})

describe('list and quote commands', () => {
  it('makes selected lines a bulleted list', () => {
    const doc = 'one\ntwo'
    expect(run(toggleBulletList, doc, 0, doc.length)).toBe('- one\n- two')
  })

  it('removes bullets when every selected line has one', () => {
    const doc = '- one\n- two'
    expect(run(toggleBulletList, doc, 0, doc.length)).toBe('one\ntwo')
  })

  it('numbers an ordered list sequentially', () => {
    const doc = 'one\ntwo\nthree'
    expect(run(toggleOrderedList, doc, 0, doc.length)).toBe('1. one\n2. two\n3. three')
  })

  it('converts bullets to numbers', () => {
    const doc = '- one\n- two'
    expect(run(toggleOrderedList, doc, 0, doc.length)).toBe('1. one\n2. two')
  })

  it('preserves indentation', () => {
    expect(run(toggleBulletList, '    indented', 6)).toBe('    - indented')
  })

  it('toggles a blockquote', () => {
    expect(run(toggleBlockquote, 'quoted', 2)).toBe('> quoted')
    expect(run(toggleBlockquote, '> quoted', 4)).toBe('quoted')
  })
})
