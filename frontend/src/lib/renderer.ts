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

md.use(katexPlugin, { throwOnError: false, errorColor: '#cc0000' })

const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim() === 'vega-lite') {
    return `<div class="vega-lite-chart" data-spec="${md.utils.escapeHtml(token.content.trim())}"></div>\n`
  }
  return defaultFence(tokens, idx, options, env, self)
}

md.use(citationPlugin)

export interface RenderOptions {
  formatter?: CitationFormatter
}

export function render(markdown: string, opts?: RenderOptions): string {
  const { body } = parseFrontmatter(markdown)
  const env: { citations?: CitationCluster[] } = {}
  let html = md.render(body, env)
  const clusters = env.citations ?? []
  const formatter = opts?.formatter
  if (!formatter || clusters.length === 0) return html

  const { texts, bibliographyHtml } = formatter.format(
    clusters.map((c) => (resolvable(formatter, c) ? c : { items: [] })),
  )
  html = html.replace(
    /<span class="citation" data-cite-index="(\d+)">(.*?)<\/span>/g,
    (whole, idx: string, raw: string) => {
      const i = Number(idx)
      const cluster = clusters[i]
      if (!cluster || !resolvable(formatter, cluster)) {
        const marked = cluster
          ? cluster.items.map((it) => `[@${it.key}${formatter.has(it.key) ? '' : '?'}]`).join(' ')
          : raw
        return `<span class="cite-error">${marked}</span>`
      }
      return `<span class="citation">${texts[i]}</span>`
    },
  )
  if (clusters.some((c) => resolvable(formatter, c))) {
    html += `<h2>References</h2>\n${bibliographyHtml}\n`
  }
  return html
}

function resolvable(f: CitationFormatter, c: CitationCluster): boolean {
  return c.items.length > 0 && c.items.every((it) => f.has(it.key))
}
