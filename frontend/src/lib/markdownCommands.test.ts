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
