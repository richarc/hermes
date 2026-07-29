import citeprocModule from 'citeproc'
import type { CSLEntry } from './bibliography'
import apa from '../assets/csl/apa.csl?raw'
import chicago from '../assets/csl/chicago-author-date.csl?raw'
import ieee from '../assets/csl/ieee.csl?raw'
import vancouver from '../assets/csl/vancouver.csl?raw'
import harvard from '../assets/csl/harvard-cite-them-right.csl?raw'
import localeEnUS from '../assets/csl/locales-en-US.xml?raw'

// CJS/ESM interop differs between Vitest and Vite's browser pre-bundle.
const CSL = ((citeprocModule as { default?: unknown }).default ??
  citeprocModule) as { Engine: new (sys: unknown, style: string) => CiteprocEngine }

interface CiteprocEngine {
  processCitationCluster(
    citation: unknown,
    pre: [string, number][],
    post: [string, number][],
  ): [unknown, [number, string, string][]]
  makeBibliography(): [{ bibstart: string; bibend: string }, string[]] | false
}

const STYLES: Record<string, string> = {
  apa,
  'chicago-author-date': chicago,
  ieee,
  vancouver,
  harvard,
}
export const STYLE_IDS = Object.keys(STYLES) as readonly string[]

export interface CitationItem {
  key: string
  prefix?: string
  suffix?: string
  locator?: string
  label?: string
  suppressAuthor?: boolean
}

export interface CitationCluster {
  items: CitationItem[]
  mode?: 'composite'
}

export interface CitationFormatter {
  format(clusters: CitationCluster[]): { texts: string[]; bibliographyHtml: string }
  has(key: string): boolean
}

export function createCitationFormatter(
  entries: CSLEntry[],
  styleId: string,
): CitationFormatter {
  const style = STYLES[styleId] ?? STYLES.apa
  const byId = new Map(entries.map((e) => [e.id, e]))
  const sys = {
    retrieveItem: (id: string) => byId.get(id),
    retrieveLocale: () => localeEnUS,
  }
  return {
    has: (key) => byId.has(key),
    format(clusters) {
      const engine = new CSL.Engine(sys, style)
      const texts: string[] = new Array(clusters.length).fill('')
      const pre: [string, number][] = []
      // citeproc's update indices are positions among SUBMITTED clusters, not
      // original cluster positions. Since empty clusters are never submitted,
      // map submitted index -> original index to keep texts[] aligned with
      // the caller's cluster array.
      const submittedToOriginal: number[] = []
      let processed = 0
      clusters.forEach((cluster, i) => {
        if (cluster.items.length === 0) return // caller-blanked cluster: keep '' at index i
        processed++
        submittedToOriginal.push(i)
        const citation = {
          citationID: `cite-${i}`,
          citationItems: cluster.items.map((item) => ({
            id: item.key,
            prefix: item.prefix,
            suffix: item.suffix,
            locator: item.locator,
            label: item.label,
            'suppress-author': item.suppressAuthor || undefined,
          })),
          properties: { noteIndex: 0, ...(cluster.mode ? { mode: cluster.mode } : {}) },
        }
        const [, updates] = engine.processCitationCluster(citation, [...pre], [])
        for (const [index, html] of updates) texts[submittedToOriginal[index]] = html
        pre.push([`cite-${i}`, 0])
      })
      if (processed === 0) return { texts, bibliographyHtml: '' }
      const bib = engine.makeBibliography()
      const bibliographyHtml = bib
        ? bib[0].bibstart + bib[1].join('') + bib[0].bibend
        : ''
      return { texts, bibliographyHtml }
    },
  }
}
