import MarkdownIt from 'markdown-it'
import katexPluginModule from '@vscode/markdown-it-katex'
import { parseFrontmatter } from './frontmatter'
import { citationPlugin, type CitationFormatter, type CitationCluster } from './citations'

// The plugin ships CJS; Vite's browser interop and Vitest's node interop
// disagree on whether the default import is the plugin function or the CJS
// exports object wrapping it. Unwrap so both environments get the function.
const katexPlugin = ((katexPluginModule as { default?: unknown }).default ??
  katexPluginModule) as Parameters<MarkdownIt['use']>[0]

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

const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim() === 'vega-lite') {
    // This branch builds its own HTML and never calls renderAttrs, so the
    // anchor the core rule set on the token has to be written out by hand.
    // Charts are the largest source of height divergence — the very reason
    // anchors beat a scroll ratio — so losing theirs would gut the feature.
    const line = token.attrGet('data-source-line') ?? ''
    return `<div class="vega-lite-chart" data-source-line="${md.utils.escapeHtml(line)}" data-spec="${md.utils.escapeHtml(token.content.trim())}"></div>\n`
  }
  return defaultFence(tokens, idx, options, env, self)
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
}

export function render(markdown: string, opts?: RenderOptions): string {
  const { body, bodyStartLine } = parseFrontmatter(markdown)
  const env: { citations?: CitationCluster[]; sourceLineOffset: number } = {
    sourceLineOffset: bodyStartLine - 1,
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
