import MarkdownIt from 'markdown-it'
import * as katexPlugin from '@vscode/markdown-it-katex'

const md = new MarkdownIt({ html: false, linkify: true })

md.use(katexPlugin.default, { throwOnError: false, errorColor: '#cc0000' })

const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim() === 'vega-lite') {
    return `<div class="vega-lite-chart" data-spec="${md.utils.escapeHtml(token.content.trim())}"></div>\n`
  }
  return defaultFence(tokens, idx, options, env, self)
}

export function render(markdown: string): string {
  return md.render(markdown)
}
