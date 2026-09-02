import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { frontmatterEndLine } from './markdownCommands'

export interface Range {
  from: number
  to: number
}

// Nodes whose text is never prose. URL is a link's destination (the text
// stays checked); Autolink is the <https://…> form. Both HTML kinds are
// markup, not words.
const PROTECTED_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'URL', 'Autolink', 'HTMLBlock', 'HTMLTag'])

// Maths and citations are not nodes in the editor's grammar (the preview
// parses them with markdown-it plugins), so they are matched by pattern.
// Pattern order below is irrelevant — every match becomes a range and all
// ranges are merged by position in mergeAndClip, regardless of which
// pattern produced them. What stops a "$$" pair from being read as two
// empty inline-maths spans is INLINE_MATH's own (?!\$): an opening $
// immediately followed by another $ is never a valid inline opener, so it
// is left for DISPLAY_MATH instead. Display maths mirrors the preview's
// @vscode/markdown-it-katex blockMath rule: the opener is a $$ at the
// start of a line (KaTeX ignores indentation), same as the plugin. The
// close is the next "$$" anywhere in the document, because the plugin
// itself closes on the first line that ends with or contains "$$" —
// including the same line, which is how it renders a single-line "$$x$$"
// as a block — not only on a line that is just "$$". Inline maths refuses
// newlines, matching KaTeX's inline rule, and requires a non-word/
// non-digit, non-backslash boundary before the opener and a non-word/
// non-digit boundary after the closer, so currency like "$5" is prose and
// an escaped "\$5" never opens a span, matching the preview's
// isValidInlineDelim. A citation group can't contain an unescaped nested
// "[" — that belongs to something else, e.g. a markdown link starting
// inside it — and can't cross a line. A bare citation key is @ followed by
// the characters Pandoc allows; the @ must start a token, so an address
// like a@b.org is not one, and it must not follow an unclosed "[" either,
// so a broken "[@key" group-attempt isn't separately re-protected as a
// bare citation. A trailing "." is never part of the key, so a
// sentence-ending citation does not swallow the full stop.
const DISPLAY_MATH = /^[ \t]*\$\$[\s\S]*?\$\$/gm
const INLINE_MATH = /(?<![\w\d\\])\$(?!\$)[^$\n]+?\$(?![\w\d])/g
// The preview's blockBareMath renders \begin{name}…\end{name} as maths with
// no dollars at all; a paper's align blocks are written that way.
const BARE_ENVIRONMENT = /\\begin\{([A-Za-z*]+)\}[\s\S]*?\\end\{\1\}/g
const CITATION_GROUP = /\[@[^[\]\n]+\]/g
const BARE_CITATION = /(?<![\w@[])@[\w][\w:#$%&\-+?<>~/]*(?:\.[\w][\w:#$%&\-+?<>~/]*)*/g

/**
 * The frontmatter block and every maths/citation pattern match, over the
 * whole document. These don't depend on the requested window — a display
 * block that starts above the viewport must still be caught — so they are
 * split out from the tree walk and computed once per document rather than
 * once per visible range: buildDecorations calls this a single time per
 * rebuild and reuses it across every range in view.visibleRanges, instead
 * of re-running doc.toString() and five regex scans per range.
 */
function documentWideRanges(state: EditorState): Range[] {
  const found: Range[] = []

  const fmEnd = frontmatterEndLine(state)
  if (fmEnd > 0) found.push({ from: 0, to: state.doc.line(fmEnd).to })

  const text = state.doc.toString()
  for (const re of [DISPLAY_MATH, INLINE_MATH, BARE_ENVIRONMENT, CITATION_GROUP, BARE_CITATION]) {
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      found.push({ from: m.index, to: m.index + m[0].length })
    }
  }

  return found
}

/** Protected nodes from the syntax tree, restricted to [from, to). */
function treeRanges(state: EditorState, from: number, to: number): Range[] {
  const found: Range[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (!PROTECTED_NODES.has(node.name)) return
      found.push({ from: node.from, to: node.to })
      return false // nothing inside a protected node needs a second range
    },
  })
  return found
}

/** treeRanges for [from, to) plus the (already-computed) document-wide ones, merged and clipped. */
function rangesWithin(state: EditorState, wide: Range[], from: number, to: number): Range[] {
  return mergeAndClip([...treeRanges(state, from, to), ...wide], from, to)
}

/**
 * The parts of [from, to) that must not be spell-checked: code, frontmatter,
 * link destinations, HTML, maths and citations. Sorted, non-overlapping,
 * clipped to the window. Pure: reads only the state.
 */
export function protectedRanges(state: EditorState, from: number, to: number): Range[] {
  return rangesWithin(state, documentWideRanges(state), from, to)
}

function mergeAndClip(ranges: Range[], from: number, to: number): Range[] {
  const clipped = ranges
    .map((r) => ({ from: Math.max(r.from, from), to: Math.min(r.to, to) }))
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from || a.to - b.to)
  const out: Range[] = []
  for (const r of clipped) {
    const last = out[out.length - 1]
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to)
    else out.push({ ...r })
  }
  return out
}

// WebKit checks per text node and honours the nearest ancestor's spellcheck
// attribute, so a span carrying "false" excludes exactly its text.
const noSpellcheck = Decoration.mark({ attributes: { spellcheck: 'false' } })

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const wide = documentWideRanges(view.state)
  for (const { from, to } of view.visibleRanges) {
    for (const r of rangesWithin(view.state, wide, from, to)) builder.add(r.from, r.to, noSpellcheck)
  }
  return builder.finish()
}

const protectedRegions = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate) {
      // The tree changing without the document changing is the language's
      // parse worker finishing more of the document.
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/**
 * Native spell checking on prose only: the content element says yes, and
 * every protected range says no. autocorrect stays off — CodeMirror's
 * default — because in-place correction rewrites source.
 */
export function spellcheckExtension(): Extension {
  return [EditorView.contentAttributes.of({ spellcheck: 'true' }), protectedRegions]
}
