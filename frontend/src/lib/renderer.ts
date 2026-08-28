import MarkdownIt from 'markdown-it'
import katexPluginModule from '@vscode/markdown-it-katex'
import type Token from 'markdown-it/lib/token.mjs'
import { outlinePlugin, type OutlineEntry } from './outline'
import { parseFrontmatter } from './frontmatter'
import { citationPlugin, type CitationFormatter, type CitationCluster } from './citations'
import {
  chartWidthPx,
  figureLabel,
  figureOf,
  figurePlugin,
  type ChartWidth,
  type FigureMeta,
} from './figures'
import { parseMermaidSource } from './mermaidSource'

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
  outline?: OutlineEntry[]
  sourceLineOffset: number
  chartWidthPx: number
  /** Absolute path of the open document; '' when it has never been saved. */
  docPath: string
}

const md = new MarkdownIt({ html: false, linkify: true })

// errorColor only decides the .katex-error class exists — KaTeX writes it as
// an inline `color` style, which style.css's `.sheet .katex-error` rule
// overrides with !important so the document palette still wins.
md.use(katexPlugin, { throwOnError: false, errorColor: '#cc0000' })

// Stamp every top-level block with the document line it starts on, for scroll
// sync to anchor against. Only level-0 tokens carry a `map`; inline tokens do
// not, which is what keeps this off spans and emphasis.
//
// `env.sourceLineOffset` corrects for the frontmatter that render() strips
// before markdown-it ever sees the text — without it every anchor in a
// document with frontmatter is short by that block's length.
md.core.ruler.push('source_line', (state) => {
  const offset = (state.env as RenderEnv).sourceLineOffset
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
md.use(outlinePlugin)

/**
 * A document-relative image source is rewritten onto the local-image route.
 *
 * The webview loads the embedded frontend bundle, so `![](fig1.png)` would
 * otherwise fetch fig1.png from that bundle rather than from beside the
 * document — which is precisely what it did until this existed. The route
 * carries the document and the source separately so Go resolves the pair with
 * resolveAgainstDoc, the same rule `bibliography:` uses.
 *
 * The token's attribute is rewritten and the default renderer still does the
 * rendering, so markdown-it's own attribute escaping continues to apply.
 */
const defaultImage = md.renderer.rules.image!
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const src = token.attrGet('src') ?? ''
  const doc = (env as RenderEnv).docPath
  // No document means nothing to resolve against — an unsaved document is in
  // the same position as one naming a `bibliography:` before it is saved.
  if (doc && isDocumentRelative(src)) {
    token.attrSet(
      'src',
      `${LOCAL_IMAGE_ROUTE}?doc=${encodeURIComponent(doc)}&src=${encodeURIComponent(decodePath(src))}`,
    )
  }
  return defaultImage(tokens, idx, options, env, self)
}

/**
 * The real filesystem path behind a markdown link destination.
 *
 * markdown-it percent-encodes destinations before a renderer ever sees them,
 * so `my figure.png` arrives as `my%20figure.png`. Encoding that again for the
 * query string would send `%2520` and have Go look for a file literally named
 * `my%20figure.png` — which is what the first version of this did. Decoding
 * first restores the name on disk. A malformed escape is left as written
 * rather than throwing; it will simply fail to resolve, like any other bad
 * path.
 */
function decodePath(src: string): string {
  try {
    return decodeURIComponent(src)
  } catch {
    return src
  }
}

/** Kept in step with `localImageRoute` in localimages.go. */
const LOCAL_IMAGE_ROUTE = '/_hermes/image'

/**
 * Whether a source names a file on disk rather than somewhere else entirely.
 *
 * Anything carrying a scheme (`https:`, `data:`, `file:`), a protocol-relative
 * `//host`, or a bare fragment is left exactly as written — remote images
 * already worked and are the only kind the test corpus had before this.
 */
function isDocumentRelative(src: string): boolean {
  if (src === '') return false
  if (src.startsWith('//') || src.startsWith('#')) return false
  return !/^[a-z][a-z0-9+.-]*:/i.test(src)
}

const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const info = tokens[idx].info.trim()
  if (info === 'vega-lite') return renderChartFence(tokens[idx], env as RenderEnv)
  if (info === 'mermaid') return renderMermaidFence(tokens[idx])
  return defaultFence(tokens, idx, options, env, self)
}

/**
 * Wraps a chart's or diagram's child markup in a <figure>, with the anchor
 * moved onto the figure and a numbered caption appended.
 *
 * The anchor moves ONTO the <figure> and must not stay on the child:
 * collectAnchors takes every [data-source-line] as an anchor, and two at
 * different offsets for one source line is a degenerate segment for
 * previewOffsetForLine to interpolate across.
 */
function wrapAsFigure(anchor: string, child: string, figure: FigureMeta): string {
  const caption = md.utils.escapeHtml(figureLabel(figure.number, figure.caption))
  return `<figure${anchor}>` + child + `<figcaption>${caption}</figcaption>` + `</figure>\n`
}

function renderChartFence(token: Token, env: RenderEnv): string {
  // This branch builds its own HTML and never calls renderAttrs, so the
  // anchor the core rule set on the token has to be written out by hand.
  // Charts are the largest source of height divergence — the very reason
  // anchors beat a scroll ratio — so losing theirs would gut the feature.
  const anchor = ` data-source-line="${md.utils.escapeHtml(token.attrGet('data-source-line') ?? '')}"`
  const figure = figureOf(token)
  const spec = md.utils.escapeHtml(
    rewriteChartSpec(token.content.trim(), env.chartWidthPx, figure !== null),
  )
  if (!figure) return `<div class="vega-lite-chart"${anchor} data-spec="${spec}"></div>\n`

  return wrapAsFigure(anchor, `<div class="vega-lite-chart" data-spec="${spec}"></div>`, figure)
}

/**
 * A mermaid fence becomes a placeholder for the hydrator to fill.
 *
 * The source is stamped in with its frontmatter title removed: Mermaid draws
 * a title into the SVG, and the caption below is where Hermes wants it.
 */
function renderMermaidFence(token: Token): string {
  const anchor = ` data-source-line="${md.utils.escapeHtml(token.attrGet('data-source-line') ?? '')}"`
  const source = md.utils.escapeHtml(parseMermaidSource(token.content).body)
  const figure = figureOf(token)
  if (!figure) return `<div class="mermaid-diagram"${anchor} data-source="${source}"></div>\n`

  return wrapAsFigure(anchor, `<div class="mermaid-diagram" data-source="${source}"></div>`, figure)
}

/**
 * Render-time only: the document's text is never touched, so the chart
 * builder still reads the block's raw spec out of the editor. `title` and
 * `width` are both in chartSpec.ts's passthrough allowlist, which is what
 * makes a builder round trip preserve them and an author's own `"width": 300`
 * keep beating the document default.
 *
 * The title TEXT is removed when the caption is being drawn below the chart —
 * otherwise Vega-Lite draws it inside the SVG as well and it appears twice.
 * Only `text` comes out: a title object can also carry a `subtitle` (and
 * styling properties), and captionFromTitle only ever reads `text` for the
 * figure caption, so deleting the whole key would silently take the subtitle
 * with it — it would appear neither in the SVG nor in the caption, with
 * nothing to tell the author. Vega-Lite's own schema marks `text` required on
 * a title object, so a bare `{"subtitle":...}` is not strictly schema-valid —
 * but this project's bundled Vega-Lite (checked against its compile step)
 * does not validate specs against that schema and does not draw a title group
 * at all when `text` is absent, subtitle included, so this cannot regress a
 * working chart into a visible error card. It is the least-bad option: the
 * subtitle at least survives into data-spec instead of being destroyed
 * outright, even though it goes undrawn until the author gives the title back
 * a `text`.
 *
 * An object left with nothing but `text` collapses to `delete spec.title`,
 * same as a bare string title, rather than emitting an empty `{}`.
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
  if (stripTitle) {
    const title = spec.title
    if (typeof title === 'object' && title !== null && !Array.isArray(title)) {
      const rest = { ...(title as Record<string, unknown>) }
      delete rest.text
      if (Object.keys(rest).length > 0) spec.title = rest
      else delete spec.title
    } else {
      delete spec.title
    }
  }
  // `{"width":null}` reads as the author explicitly setting a width — an
  // author's own choice always wins over the document default, `null`
  // included — even though it is the one input where that produces a spec
  // Vega-Lite may not accept. Deliberate, not an oversight.
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
  /**
   * Absolute path of the open document. Image sources are resolved against
   * its folder; an unsaved document has none, so they are left as written.
   */
  docPath?: string | null
}

export interface RenderResult {
  html: string
  /** The document's headings, for the outline panel. */
  outline: OutlineEntry[]
}

/** render() for callers that only want the HTML — every test and most rules. */
export function render(markdown: string, opts?: RenderOptions): string {
  return renderDocument(markdown, opts).html
}

export function renderDocument(markdown: string, opts?: RenderOptions): RenderResult {
  const { body, bodyStartLine } = parseFrontmatter(markdown)
  const env: RenderEnv = {
    sourceLineOffset: bodyStartLine - 1,
    chartWidthPx: chartWidthPx(opts?.chartWidth),
    docPath: opts?.docPath ?? '',
  }
  let html = md.render(body, env)
  const outline = env.outline ?? []
  const clusters = env.citations ?? []
  const formatter = opts?.formatter
  if (!formatter || clusters.length === 0) return { html, outline }

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
  return { html, outline }
}

function resolvable(f: CitationFormatter, c: CitationCluster): boolean {
  return c.items.length > 0 && c.items.every((it) => f.has(it.key))
}
