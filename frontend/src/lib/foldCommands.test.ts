import { describe, it, expect } from 'vitest'
import { EditorState, type Transaction } from '@codemirror/state'
import { history, undo, undoDepth } from '@codemirror/commands'
import { codeFolding, foldedRanges, foldGutter } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { foldAllCodeBlocks } from './foldCommands'

const DOC = `# Results

Prose here.

\`\`\`vega-lite
{
  "mark": "bar"
}
\`\`\`

More prose.

\`\`\`js
const x = 1
\`\`\`

| a | b |
|---|---|
| 1 | 2 |
`

function makeState(doc = DOC) {
  // codeFolding() supplies the fold state the effects land in; markdown()
  // supplies the syntax tree the command walks. No DOM needed for either.
  return EditorState.create({ doc, extensions: [codeFolding(), foldGutter(), markdown()] })
}

/** Runs the command and returns the resulting state. */
function run(state: EditorState): { state: EditorState; handled: boolean } {
  let tr: Transaction | null = null
  const handled = foldAllCodeBlocks({ state, dispatch: (t) => (tr = t) })
  return { state: tr ? (tr as Transaction).state : state, handled }
}

/** The 1-based first line of every folded range. */
function foldedStartLines(state: EditorState): number[] {
  const lines: number[] = []
  foldedRanges(state).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number)
  })
  return lines.sort((a, b) => a - b)
}

describe('foldAllCodeBlocks', () => {
  it('folds every fenced code block', () => {
    const { state, handled } = run(makeState())
    expect(handled).toBe(true)
    // Fold ranges start at the END of the fence's opening line, so both
    // folds begin on the line carrying ``` — lines 5 and 13.
    expect(foldedStartLines(state)).toEqual([5, 13])
  })

  it('leaves headings and tables alone', () => {
    // The distinction from CodeMirror's foldAll, which folds those too.
    const { state } = run(makeState())
    const folded = foldedStartLines(state)
    expect(folded).not.toContain(1) // "# Results"
    expect(folded).not.toContain(17) // the table
  })

  it('is a no-op the second time', () => {
    const first = run(makeState())
    const second = run(first.state)
    expect(second.handled).toBe(false)
    expect(foldedStartLines(second.state)).toEqual([5, 13])
  })

  it('does nothing in a document with no code blocks', () => {
    const { state, handled } = run(makeState('# Title\n\nJust prose.\n'))
    expect(handled).toBe(false)
    expect(foldedStartLines(state)).toEqual([])
  })

  it('folds every block in a single transaction', () => {
    let count = 0
    const state = makeState()
    foldAllCodeBlocks({ state, dispatch: () => count++ })
    expect(count).toBe(1)
  })

  it('leaves folds untouched by undo, because folds are not in the history', () => {
    // Folds are state effects, not document changes, and CodeMirror never
    // registers foldEffect/unfoldEffect with @codemirror/commands'
    // invertedEffects facet — so they sit outside the undo history entirely.
    // Verified empirically: after a text edit followed by foldAllCodeBlocks,
    // pressing undo leaves the blocks folded and reverts the text edit
    // instead. Unfold All, not undo, is the way back.
    let state = EditorState.create({
      doc: DOC,
      extensions: [codeFolding(), foldGutter(), markdown(), history()],
    })
    state = state.update({ changes: { from: 0, insert: '// edit\n' } }).state
    expect(undoDepth(state)).toBe(1)

    const { state: folded, handled } = run(state)
    expect(handled).toBe(true)
    expect(foldedStartLines(folded).length).toBeGreaterThan(0)

    // Undo consumes the text edit — the only thing actually in the history —
    // not the fold. If folds were in the undo history, this single undo
    // would instead unfold everything and leave "// edit" in place.
    let afterUndo = folded
    undo({ state: folded, dispatch: (tr) => (afterUndo = tr.state) })

    expect(afterUndo.doc.toString()).toBe(DOC)
    expect(foldedStartLines(afterUndo).length).toBeGreaterThan(0)
  })

  it('folds a block past the synchronous parse prefix on a long document', () => {
    // CodeMirror only parses min(3000, doc.length) characters synchronously
    // when a state is created; the rest is filled in later by an idle-driven
    // ViewPlugin. Build a document comfortably past that threshold with the
    // fenced block near the end, past where the initial parse would stop.
    const prose = 'Prose line.\n'.repeat(400)
    expect(prose.length).toBeGreaterThan(3000)
    const doc = `${prose}\n\`\`\`js\nconst x = 1\n\`\`\`\n`
    // 1-based line number of the fence, computed from the doc itself rather
    // than hardcoded, so this doesn't drift if `prose` changes.
    const fenceLine = doc.slice(0, doc.indexOf('```js')).split('\n').length

    const { state, handled } = run(makeState(doc))
    expect(handled).toBe(true)
    expect(foldedStartLines(state)).toContain(fenceLine)
  })
})
