import type { OutlineEntry } from './outline'

/**
 * The table of contents: slugs for heading anchors, the depth rule, and the
 * nested list the `[[toc]]` marker (or the top of the document) renders as.
 * Pure string work; the renderer owns where these are called from.
 */

/** An outline entry paired with the anchor slug its heading was given. */
export interface TocItem {
  entry: OutlineEntry
  slug: string
}

/** Pandoc's default, and the vocabulary is Pandoc's (`toc-depth`). */
export const DEFAULT_TOC_DEPTH = 3

/**
 * GitHub-style anchor slug: lowercased, whitespace to hyphens, everything
 * but letters, digits, hyphens and underscores dropped. Not deduplicated —
 * the renderer holds the per-document counter, since uniqueness is a
 * property of the document, not of one heading.
 */
export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
  return slug === '' ? 'heading' : slug
}

/**
 * The depth a heading must not exceed to be listed. Anything but a whole
 * number from 1 to 6 reads as the default: the key is advisory, and a typo
 * should degrade to the ordinary contents page, not an empty one.
 */
export function tocDepth(raw: string | undefined): number {
  if (raw === undefined || !/^[1-6]$/.test(raw.trim())) return DEFAULT_TOC_DEPTH
  return Number(raw.trim())
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The nested `<ul>` for the given items, in document order. Levels nest
 * relative to the first item's: a deeper item opens a list inside the
 * previous one (a jump over a level opens the wrappers it skipped), a
 * shallower one closes back out, and a heading shallower than the first is
 * listed at the first's depth — the alternative is markup that closes the
 * outermost list with items still to come.
 */
export function buildTocListHtml(items: TocItem[]): string {
  if (items.length === 0) return ''
  const link = (item: TocItem) =>
    `<a href="#${escapeHtml(item.slug)}">${escapeHtml(item.entry.text)}</a>`
  const first = items[0].entry.level
  let out = '<ul><li>' + link(items[0])
  let prev = first
  for (const item of items.slice(1)) {
    const level = Math.max(item.entry.level, first)
    if (level > prev) {
      out += '<ul>' + '<li><ul>'.repeat(level - prev - 1) + '<li>' + link(item)
    } else if (level === prev) {
      out += '</li><li>' + link(item)
    } else {
      out += '</li>' + '</ul></li>'.repeat(prev - level) + '<li>' + link(item)
    }
    prev = level
  }
  return out + '</li>' + '</ul></li>'.repeat(prev - first) + '</ul>'
}
