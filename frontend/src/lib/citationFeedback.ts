import MarkdownIt from 'markdown-it'
import { citationPlugin, type CitationCluster } from './citations'

// Parsing goes through the real citation rule rather than a local regex, so a
// warning can never disagree with what the preview actually resolves.
const md = new MarkdownIt({ html: false }).use(citationPlugin)

export function extractCitationKeys(text: string): string[] {
  if (!text.trim()) return []
  const env: { citations?: CitationCluster[] } = {}
  md.render(text, env)
  return (env.citations ?? []).flatMap((cluster) => cluster.items.map((item) => item.key))
}

/**
 * Warns that citations just inserted into the document name entries the
 * bibliography does not contain — the usual cause is picking from Zotero while
 * the document points at a .bib that is not an export of that library.
 * Returns null when there is nothing to say.
 */
export function unresolvedInsertionMessage(
  inserted: string,
  has: (key: string) => boolean,
  bibliographyName: string | null,
): string | null {
  if (!bibliographyName) return null
  const missing = [...new Set(extractCitationKeys(inserted))].filter((key) => !has(key))
  if (missing.length === 0) return null
  const keys = missing.map((key) => `[@${key}]`).join(', ')
  return missing.length === 1
    ? `${keys} is not in ${bibliographyName}`
    : `${keys} are not in ${bibliographyName}`
}

/**
 * Warns that a document naming a bibliography cannot load it yet, because the
 * path is resolved relative to the document and an unsaved document has none.
 * Returns null when there is nothing to say.
 */
export function unsavedBibliographyMessage(
  bibliography: string | undefined,
  path: string | null,
): string | null {
  if (!bibliography || path) return null
  return `Save the document to load ${bibliography}`
}
