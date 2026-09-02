import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
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
// Display maths first so a $$ pair is never read as two empty inline spans;
// inline maths refuses newlines, matching KaTeX's inline rule; a citation
// key is @ followed by the characters Pandoc allows, and the @ must start a
// token so an address like a@b.org is not one.
const DISPLAY_MATH = /\$\$[\s\S]+?\$\$/g
const INLINE_MATH = /\$(?!\$)[^$\n]+?\$/g
const CITATION_GROUP = /\[@[^\]]+\]/g
const BARE_CITATION = /(?<![\w@])@[\w][\w:.#$%&\-+?<>~/]*/g

/**
 * The parts of [from, to) that must not be spell-checked: code, frontmatter,
 * link destinations, HTML, maths and citations. Sorted, non-overlapping,
 * clipped to the window. Pure: reads only the state.
 */
export function protectedRanges(state: EditorState, from: number, to: number): Range[] {
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

  const fmEnd = frontmatterEndLine(state)
  if (fmEnd > 0) found.push({ from: 0, to: state.doc.line(fmEnd).to })

  // Patterns run over the whole document rather than the window so a
  // display block that starts above the viewport is still caught; documents
  // are small and this runs once per update.
  const text = state.doc.toString()
  for (const re of [DISPLAY_MATH, INLINE_MATH, CITATION_GROUP, BARE_CITATION]) {
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      found.push({ from: m.index, to: m.index + m[0].length })
    }
  }

  return mergeAndClip(found, from, to)
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
  for (const { from, to } of view.visibleRanges) {
    for (const r of protectedRanges(view.state, from, to)) builder.add(r.from, r.to, noSpellcheck)
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
