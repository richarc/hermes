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
---
`
