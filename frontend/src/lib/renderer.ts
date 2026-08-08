import MarkdownIt from 'markdown-it'
import katexPluginModule from '@vscode/markdown-it-katex'
import { parseFrontmatter } from './frontmatter'
import { citationPlugin, type CitationFormatter, type CitationCluster } from './citations'
import { chartWidthPx, figureLabel, figureOf, figurePlugin, type ChartWidth } from './figures'

// The plugin ships CJS; Vite's browser interop and Vitest's node interop
// disagree on whether the default import is the plugin function or the CJS
// exports object wrapping it. Unwrap so both environments get the function.
const katexPlugin = ((katexPluginModule as { default?: unknown }).default ??
  katexPluginModule) as Parameters<MarkdownIt['use']>[0]

/**
 * The per-render environment markdown-it threads through to the rules. Typed
 * once here rather than cast at each use: the fence renderer reads the chart
 * width out of it, and the source_line rule reads the frontmatter offset.
 */
interface RenderEnv {
  citations?: CitationCluster[]
  sourceLineOffset: number
  chartWidthPx: number
}

const md = new MarkdownIt({ html: false, linkify: true })

// errorColor only decides the .katex-error class exists — KaTeX writes it as
// an inline `color` style, which style.css's .preview-pane .katex-error rule
// overrides with !important so the palette (and dark mode) still wins.
md.use(katexPlugin, { throwOnError: false, errorColor: '#cc0000' })

// Stamp every top-level block with the document line it starts on, for scroll
// sync to anchor against. Only level-0 tokens carry a `map`; inline tokens do
// not, which is what keeps this off spans and emphasis.
//
// `env.sourceLineOffset` corrects for the frontmatter that render() strips
// before markdown-it ever sees the text — without it every anchor in a
// document with frontmatter is short by that block's length.
md.core.ruler.push('source_line', (state) => {
  const offset = (state.env as { sourceLineOffset?: number }).sourceLineOffset ?? 0
  for (const token of state.tokens) {
    if (token.level === 0 && token.map) {
      token.attrSet('data-source-line', String(token.map[0] + 1 + offset))
    }
  }
  return true
})

// Pushed after source_line so a paragraph that becomes a <figure> already
// carries its anchor, and the retag carries it along.
md.use(figurePlugin)

const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim() !== 'vega-lite') return defaultFence(tokens, idx, options, env, self)

  // This branch builds its own HTML and never calls renderAttrs, so the
  // anchor the core rule set on the token has to be written out by hand.
  // Charts are the largest source of height divergence — the very reason
  // anchors beat a scroll ratio — so losing theirs would gut the feature.
  const anchor = ` data-source-line="${md.utils.escapeHtml(token.attrGet('data-source-line') ?? '')}"`
  const figure = figureOf(token)
  const spec = md.utils.escapeHtml(
    rewriteChartSpec(token.content.trim(), (env as RenderEnv).chartWidthPx, figure !== null),
  )
  if (!figure) return `<div class="vega-lite-chart"${anchor} data-spec="${spec}"></div>\n`

  // The anchor moves ONTO the <figure> and must not stay on the child:
  // collectAnchors takes every [data-source-line] as an anchor, and two at
  // different offsets for one source line is a degenerate segment for
  // previewOffsetForLine to interpolate across.
  const caption = md.utils.escapeHtml(figureLabel(figure.number, figure.caption))
  return (
    `<figure${anchor}>` +
    `<div class="vega-lite-chart" data-spec="${spec}"></div>` +
    `<figcaption>${caption}</figcaption>` +
    `</figure>\n`
  )
}

/**
 * Render-time only: the document's text is never touched, so the chart
 * builder still reads the block's raw spec out of the editor. `title` and
 * `width` are both in chartSpec.ts's passthrough allowlist, which is what
 * makes a builder round trip preserve them and an author's own `"width": 300`
 * keep beating the document default.
 *
 * The title is removed when the caption is being drawn below the chart —
 * otherwise Vega-Lite draws it inside the SVG as well and it appears twice.
 *
 * Anything that is not a JSON object is returned verbatim, so a malformed
 * spec still reaches the hydrator's error card unchanged.
 */
function rewriteChartSpec(text: string, widthPx: number, stripTitle: boolean): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return text
  const spec = { ...(parsed as Record<string, unknown>) }
  if (stripTitle) delete spec.title
  if (!('width' in spec)) spec.width = widthPx
  return JSON.stringify(spec)
}

// Same problem, same fix, for display math (`$$…$$`): @vscode/markdown-it-katex
// installs its own `math_block` renderer that builds a `<p class="katex-block">`
// from tokens[idx].content by hand and never calls renderAttrs, so the anchor
// the core rule set above is silently dropped. Captured after md.use(katexPlugin)
// so this wraps whatever renderer the plugin actually installed, not a guess at
// its name — this project doesn't pass enableFencedBlocks or enableBareBlocks,
// so math_block is the only katex renderer that ever emits block-level output.
const defaultMathBlock = md.renderer.rules.math_block!
md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
  const line = tokens[idx].attrGet('data-source-line')
  const rendered = defaultMathBlock(tokens, idx, options, env, self)
  if (!line) return rendered
  return rendered.replace(/^<p /, `<p data-source-line="${md.utils.escapeHtml(line)}" `)
}

md.use(citationPlugin)

export interface RenderOptions {
  formatter?: CitationFormatter
  /** Document-wide default width; a spec's own `width` still wins. */
  chartWidth?: ChartWidth
}

export function render(markdown: string, opts?: RenderOptions): string {
  const { body, bodyStartLine } = parseFrontmatter(markdown)
  const env: RenderEnv = {
    sourceLineOffset: bodyStartLine - 1,
    chartWidthPx: chartWidthPx(opts?.chartWidth),
  }
  let html = md.render(body, env)
  const clusters = env.citations ?? []
  const formatter = opts?.formatter
  if (!formatter || clusters.length === 0) return html

  const { texts, bibliographyHtml } = formatter.format(
    clusters.map((c) => (resolvable(formatter, c) ? c : { items: [] })),
  )
  html = html.replace(
    // The s flag matters: a hard-wrapped citation group keeps its newline in
    // the placeholder, and without it the group renders as raw markup.
    /<span class="citation" data-cite-index="(\d+)">(.*?)<\/span>/gs,
    (whole, idx: string, raw: string) => {
      const i = Number(idx)
      const cluster = clusters[i]
      if (!cluster || !resolvable(formatter, cluster)) {
        const marked = cluster
          ? cluster.items
              .map(
                (it) =>
                  `[@${md.utils.escapeHtml(it.key)}${formatter.has(it.key) ? '' : '?'}]`,
              )
              .join(' ')
          : md.utils.escapeHtml(raw)
        return `<span class="cite-error">${marked}</span>`
      }
      return `<span class="citation">${texts[i]}</span>`
    },
  )
  if (clusters.some((c) => resolvable(formatter, c))) {
    // Anchor the appended heading to the document's last line, so the
    // bibliography's height (often substantial) doesn't collapse into a
    // single interpolated interval hanging off the last real anchor.
    const docLines = markdown.split(/\r\n?|\n/).length
    html += `<h2 data-source-line="${docLines}">References</h2>\n${bibliographyHtml}\n`
  }
  return html
}

function resolvable(f: CitationFormatter, c: CitationCluster): boolean {
  return c.items.length > 0 && c.items.every((it) => f.has(it.key))
}
