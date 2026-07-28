import MarkdownIt from 'markdown-it'
import katexPluginModule from '@vscode/markdown-it-katex'

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

export function render(markdown: string): string {
  return md.render(markdown)
}
