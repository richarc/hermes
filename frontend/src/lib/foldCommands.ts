import { syntaxTree, foldable, foldEffect, foldedRanges, ensureSyntaxTree } from '@codemirror/language'
import type { StateCommand, StateEffect } from '@codemirror/state'

/**
 * Folds every fenced code block, and nothing else.
 *
 * Deliberately not CodeMirror's `foldAll`, which folds every foldable block
 * including headings — collapsing a paper into an outline. That is a different
 * feature; this one hides the long blocks a reader skips past.
 *
 * One transaction, so the fold lands atomically rather than block by block.
 * Note folds are state effects and are NOT in the undo history — CodeMirror
 * does not register foldEffect with invertedEffects — so undo will not
 * restore them. Unfold All is the reverse operation.
 */
export const foldAllCodeBlocks: StateCommand = ({ state, dispatch }) => {
  const already = foldedRanges(state)
  // Annotated rather than left to inference: an empty array literal infers
  // any[], which svelte-check rejects.
  const effects: StateEffect<unknown>[] = []

  // CodeMirror only parses a prefix of long documents synchronously
  // (Work.InitViewport = 3000 chars) when a state is created; the rest is
  // filled in later by an idle-driven ViewPlugin. That matters here
  // specifically: this command exists because documents get long with big
  // vega-lite specs, so a block past that prefix would otherwise silently
  // fail to fold. Force the parse to completion first.
  const complete = ensureSyntaxTree(state, state.doc.length, 5000)

  // ensureSyntaxTree() advances the shared parse context in place, but the
  // `state` we were handed doesn't pick that up until a transaction runs
  // through it — syntaxTree()/foldable() would otherwise still see the old,
  // partial tree even though parsing just finished. This is the same reason
  // CodeMirror's own `forceParsing` (for views) dispatches an empty
  // transaction after calling ensureSyntaxTree. Do the same here, purely to
  // read from: the doc is unchanged, so positions computed against `known`
  // are equally valid against `state`, which is what we actually dispatch
  // from below.
  //
  // If parsing timed out (`complete` is null), skip the refresh and fold
  // whatever's already known rather than doing nothing — a partial fold
  // beats a silent no-op, and the command can simply be run again once
  // background parsing has caught up.
  const known = complete ? state.update({}).state : state

  syntaxTree(known).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const line = known.doc.lineAt(node.from)
      const range = foldable(known, line.from, line.to)
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
