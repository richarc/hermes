import { syntaxTree, foldable, foldEffect, foldedRanges } from '@codemirror/language'
import type { StateCommand, StateEffect } from '@codemirror/state'

/**
 * Folds every fenced code block, and nothing else.
 *
 * Deliberately not CodeMirror's `foldAll`, which folds every foldable block
 * including headings — collapsing a paper into an outline. That is a different
 * feature; this one hides the long blocks a reader skips past.
 *
 * One transaction, so a single undo restores the whole document's view.
 */
export const foldAllCodeBlocks: StateCommand = ({ state, dispatch }) => {
  const already = foldedRanges(state)
  // Annotated rather than left to inference: an empty array literal infers
  // any[], which svelte-check rejects.
  const effects: StateEffect<unknown>[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const line = state.doc.lineAt(node.from)
      const range = foldable(state, line.from, line.to)
      if (!range) return
      // Skip blocks already folded, so running twice is a no-op rather than
      // stacking duplicate ranges.
      let isFolded = false
      already.between(range.from, range.to, (from, to) => {
        if (from === range.from && to === range.to) isFolded = true
      })
      if (!isFolded) effects.push(foldEffect.of(range))
    },
  })

  if (effects.length === 0) return false
  dispatch(state.update({ effects }))
  return true
}
