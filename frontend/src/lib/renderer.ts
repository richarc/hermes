import MarkdownIt from 'markdown-it'
import * as katexPlugin from '@vscode/markdown-it-katex'

const md = new MarkdownIt({ html: false, linkify: true })

md.use(katexPlugin.default, { throwOnError: false, errorColor: '#cc0000' })

export function render(markdown: string): string {
  return md.render(markdown)
}
