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

import { EditorSelection, type ChangeSpec, type StateCommand } from '@codemirror/state'

type BlockKind = 'heading' | 'bullet' | 'ordered' | 'quote' | 'none'

interface ParsedLine {
  indent: string
  kind: BlockKind
  level: number // heading level; 0 otherwise
  content: string
}

const LINE_RE = /^([ \t]*)(?:(#{1,6})[ \t]+|([-*+])[ \t]+|(\d+)[.)][ \t]+|(>)[ \t]?)?(.*)$/

function parseLine(text: string): ParsedLine {
  // LINE_RE always matches: every group after the indent is optional.
  const m = LINE_RE.exec(text) as RegExpExecArray
  const [, indent, hashes, bullet, ordered, quote, content] = m
  if (hashes) return { indent, kind: 'heading', level: hashes.length, content }
  if (bullet) return { indent, kind: 'bullet', level: 0, content }
  if (ordered) return { indent, kind: 'ordered', level: 0, content }
  if (quote) return { indent, kind: 'quote', level: 0, content }
  return { indent, kind: 'none', level: 0, content }
}

function renderLine(p: ParsedLine, ordinal: number): string {
  switch (p.kind) {
    case 'heading':
      return `${p.indent}${'#'.repeat(p.level)} ${p.content}`
    case 'bullet':
      return `${p.indent}- ${p.content}`
    case 'ordered':
      return `${p.indent}${ordinal}. ${p.content}`
    case 'quote':
      return `${p.indent}> ${p.content}`
    default:
      return `${p.indent}${p.content}`
  }
}

/**
 * Builds a line-wise command. `has` reports whether a line already carries the
 * format; when every target line does, `off` is applied to all of them,
 * otherwise `on` is. Deciding once for the whole selection — rather than per
 * line — is what makes a mixed selection resolve toward the requested format.
 */
function blockCommand(
  has: (p: ParsedLine) => boolean,
  on: (p: ParsedLine) => ParsedLine,
  off: (p: ParsedLine) => ParsedLine,
): StateCommand {
  return ({ state, dispatch }) => {
    const lines: number[] = []
    const seen = new Set<number>()
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number
      const last = state.doc.lineAt(range.to).number
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue
        seen.add(n)
        if (isProtected(state, state.doc.line(n).from)) continue
        lines.push(n)
      }
    }
    if (lines.length === 0) return false

    const parsed = lines.map((n) => parseLine(state.doc.line(n).text))
    const allHave = parsed.every(has)
    const changes: ChangeSpec[] = []
    let ordinal = 0
    lines.forEach((n, i) => {
      const next = allHave ? off(parsed[i]) : on(parsed[i])
      ordinal++
      const text = renderLine(next, ordinal)
      const line = state.doc.line(n)
      if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text })
    })
    if (changes.length === 0) return false

    // One transaction: one undo step. Selection maps through the changes.
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'format' }))
    return true
  }
}

const clear = (p: ParsedLine): ParsedLine => ({ ...p, kind: 'none', level: 0 })

export function toggleHeading(level: number): StateCommand {
  if (level === 0) {
    return blockCommand(
      (p) => p.kind !== 'heading',
      clear,
      clear,
    )
  }
  return blockCommand(
    (p) => p.kind === 'heading' && p.level === level,
    (p) => ({ ...p, kind: 'heading', level }),
    clear,
  )
}

export const toggleBulletList = blockCommand(
  (p) => p.kind === 'bullet',
  (p) => ({ ...p, kind: 'bullet', level: 0 }),
  clear,
)

export const toggleOrderedList = blockCommand(
  (p) => p.kind === 'ordered',
  (p) => ({ ...p, kind: 'ordered', level: 0 }),
  clear,
)

export const toggleBlockquote = blockCommand(
  (p) => p.kind === 'quote',
  (p) => ({ ...p, kind: 'quote', level: 0 }),
  clear,
)

// A single-character mark doubled is a different mark: * is italic but ** is
// bold. Without this check, italicising bold text would strip one * per side
// and silently downgrade it.
function isDoubled(state: EditorState, from: number, to: number, mark: string): boolean {
  if (mark.length !== 1) return false
  return (
    state.sliceDoc(from - mark.length * 2, from - mark.length) === mark ||
    state.sliceDoc(to + mark.length, to + mark.length * 2) === mark
  )
}

function wrappedOutside(state: EditorState, from: number, to: number, mark: string): boolean {
  return (
    state.sliceDoc(from - mark.length, from) === mark &&
    state.sliceDoc(to, to + mark.length) === mark &&
    !isDoubled(state, from, to, mark)
  )
}

function runLength(text: string, ch: string, fromEnd: boolean): number {
  let n = 0
  while (n < text.length && text[fromEnd ? text.length - 1 - n : n] === ch) n++
  return n
}

function wrappedInside(text: string, mark: string): boolean {
  if (text.length < mark.length * 2) return false
  if (!text.startsWith(mark) || !text.endsWith(mark)) return false
  // The outside-the-selection path has isDoubled for this; the inside path
  // needs its own check. A run of single-char marks encodes a different format
  // per length — * is italic, ** is bold, *** is both — so only an odd run
  // carries the italic layer. Without this, selecting **word** whole and
  // asking for italic would strip one * per side and downgrade the bold.
  if (mark.length === 1) {
    return runLength(text, mark, false) % 2 === 1 && runLength(text, mark, true) % 2 === 1
  }
  return true
}

function toggleInline(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const ranges = state.selection.ranges
    if (ranges.every((r) => isProtected(state, r.from))) return false

    // Uniform toggle rule: remove only when every range already has the mark.
    const active = ranges.every(
      (r) =>
        !r.empty &&
        (wrappedOutside(state, r.from, r.to, mark) ||
          wrappedInside(state.sliceDoc(r.from, r.to), mark)),
    )

    const tr = state.changeByRange((range) => {
      if (isProtected(state, range.from)) return { range }

      if (active) {
        if (wrappedOutside(state, range.from, range.to, mark)) {
          const len = mark.length
          return {
            changes: [
              { from: range.from - len, to: range.from },
              { from: range.to, to: range.to + len },
            ],
            range: EditorSelection.range(range.from - len, range.to - len),
          }
        }
        const text = state.sliceDoc(range.from, range.to)
        const inner = text.slice(mark.length, text.length - mark.length)
        return {
          changes: { from: range.from, to: range.to, insert: inner },
          range: EditorSelection.range(range.from, range.from + inner.length),
        }
      }

      const text = state.sliceDoc(range.from, range.to)
      return {
        changes: { from: range.from, to: range.to, insert: mark + text + mark },
        range: text.length === 0
          ? EditorSelection.cursor(range.from + mark.length)
          : EditorSelection.range(range.from + mark.length, range.to + mark.length),
      }
    })

    dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'format' }))
    return true
  }
}

export const toggleBold = toggleInline('**')
export const toggleItalic = toggleInline('*')
export const toggleInlineCode = toggleInline('`')
export const toggleStrikethrough = toggleInline('~~')
