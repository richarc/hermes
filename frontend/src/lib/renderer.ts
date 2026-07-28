import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true })

export function render(markdown: string): string {
  return md.render(markdown)
}
