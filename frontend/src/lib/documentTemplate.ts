import { STYLE_IDS } from './citations'

/**
 * Seed text for a new document.
 *
 * The `bibliography` and `csl` keys are deliberately commented out. A live key
 * naming a file that does not exist would fire the "Bibliography not found"
 * toast on every new document. `parseFrontmatter` only matches lines starting
 * with a letter, so a `#` line is inert for free.
 *
 * The guidance is YAML comments *inside* the fences rather than HTML comments:
 * the renderer runs markdown-it with `html: false`, so `<!-- ... -->` would be
 * escaped and show up as literal text in the preview, whereas the frontmatter
 * block is stripped wholesale.
 *
 * It names all five bundled styles because they are otherwise documented only
 * in the README, and a user who does not know them cannot use `csl:` at all.
 */
export const NEW_DOCUMENT_TEMPLATE = `---
# To cite: put a .bib file beside this document, name
# it below, then write [@key] in your text. Styles:
# apa, chicago-author-date, ieee, vancouver, harvard.
# bibliography: references.bib
# csl: apa
# toc: true  (a [[toc]] paragraph positions the contents)
---
`

/**
 * What a bibliography created by File → New… starts as. A comment rather than
 * nothing: an empty file is easy to mistake for a failed write, and `%` lines
 * are exactly what parseBib skips, so there is nothing for it to warn about.
 */
export const BIBLIOGRAPHY_SEED = `% Bibliography for the document beside this file.
% Export from Zotero (Better BibTeX keeps it in sync) or paste BibTeX entries here.
`

/**
 * The text of a document created by File → New…, given the frontmatter value
 * naming its bibliography, or null for none. With a bibliography the keys are
 * *live* — the `.bib` either already exists or is created beside the document
 * by the same action, so there is no missing-file toast to avoid and no
 * reason to make the author uncomment anything. Without one, the ordinary
 * commented template is right: it explains how to add a bibliography later.
 */
export function newDocumentText(bibliography: string | null, csl: string): string {
  if (bibliography === null) return NEW_DOCUMENT_TEMPLATE
  if (!STYLE_IDS.includes(csl)) throw new Error(`unknown citation style: ${csl}`)
  return `---
bibliography: ${bibliography}
csl: ${csl}
---
`
}

/**
 * How the frontmatter should name an existing bibliography: relative when
 * the file is in the document's folder or below, absolute otherwise. Both
 * forms resolve through Go's resolveAgainstDoc; the relative one survives
 * the folder being moved or shared, which is why it is preferred when it
 * can be. The directory check is against `dir + '/'`, so a sibling folder
 * whose name merely starts with the document's does not count as inside.
 */
export function bibliographyReference(bibPath: string, docPath: string): string {
  const dir = docPath.replace(/[^\/]*$/, '')
  return bibPath.startsWith(dir) ? bibPath.slice(dir.length) : bibPath
}

/** A typed bibliography name with `.bib` guaranteed; '' when nothing was typed. */
export function withBibExtension(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return ''
  return /\.bib$/i.test(trimmed) ? trimmed : `${trimmed}.bib`
}
