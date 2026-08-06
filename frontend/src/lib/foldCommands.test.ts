import { describe, it, expect } from 'vitest'
import { EditorState, type Transaction } from '@codemirror/state'
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

  it('folds in a single transaction, so one undo restores everything', () => {
    let count = 0
    const state = makeState()
    foldAllCodeBlocks({ state, dispatch: () => count++ })
    expect(count).toBe(1)
  })
})
