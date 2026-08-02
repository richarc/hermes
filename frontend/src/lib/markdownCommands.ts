import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

// Lezer markdown node names covering fenced blocks and inline spans. The
// syntax tree is already maintained for highlighting, so querying it is free.
const CODE_NODES = new Set(['FencedCode', 'CodeText', 'CodeBlock', 'InlineCode'])

function isInCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolveInner(pos, 1)
  for (;;) {
    if (CODE_NODES.has(node.name)) return true
    if (!node.parent) return false
    node = node.parent
  }
}

const FENCE_RE = /^---[ \t]*\r?$/

// The markdown grammar has no frontmatter concept — it reads the block as a
// setext heading — so the fence is located by line instead. Mirrors the rule
// in lib/frontmatter.ts: a leading --- line closed by a later --- line.
function frontmatterEndLine(state: EditorState): number {
  if (!FENCE_RE.test(state.doc.line(1).text)) return 0
  for (let n = 2; n <= state.doc.lines; n++) {
    if (FENCE_RE.test(state.doc.line(n).text)) return n
  }
  return 0 // unterminated: not frontmatter
}

/** True when pos sits in text no formatting command may rewrite. */
export function isProtected(state: EditorState, pos: number): boolean {
  const end = frontmatterEndLine(state)
  if (end > 0 && state.doc.lineAt(pos).number <= end) return true
  return isInCode(state, pos)
}
