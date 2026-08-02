### Task 3: CSL assets + citation formatter

**Files:**
- Create: `frontend/src/assets/csl/` (5 styles + locale + LICENSE.md), `frontend/src/lib/citations.ts` (formatter half), `frontend/src/lib/citations.test.ts` (formatter tests)

**Interfaces:**
- Consumes: `CSLEntry` from Task 2.
- Produces (Tasks 5/8 rely on these exactly):
  - `STYLE_IDS: readonly string[]` — `['apa', 'chicago-author-date', 'ieee', 'vancouver', 'harvard']`
  - `createCitationFormatter(entries: CSLEntry[], styleId: string): CitationFormatter` — unknown styleId falls back to `apa`.
  - `interface CitationFormatter { format(clusters: CitationCluster[]): { texts: string[]; bibliographyHtml: string }; has(key: string): boolean }` — `texts[i]` is the formatted HTML for cluster `i` (`''` for a cluster with empty `items`, which `format` must skip while keeping index alignment); `bibliographyHtml` is the full `bibstart + entries + bibend` block, empty string when no formattable clusters; `has` reports whether a citekey resolves.
  - `interface CitationCluster { items: CitationItem[]; mode?: 'composite' }` and `interface CitationItem { key: string; prefix?: string; suffix?: string; locator?: string; label?: string; suppressAuthor?: boolean }` (Task 4's parser emits these).

- [ ] **Step 1: Vendor the assets**

```bash
cd frontend/src/assets && mkdir -p csl && cd csl
for s in apa chicago-author-date ieee vancouver harvard-cite-them-right; do
  curl -sL -o "$s.csl" "https://raw.githubusercontent.com/citation-style-language/styles/master/$s.csl"
done
curl -sL -o locales-en-US.xml "https://raw.githubusercontent.com/citation-style-language/locales/master/locales-en-US.xml"
ls -la   # every file tens of KB, none empty or HTML error pages
```
Create `LICENSE.md` in the same directory: one paragraph stating the `.csl` and locale files come from the Citation Style Language project (github.com/citation-style-language) under CC-BY-SA-3.0.

- [ ] **Step 2: Verify citeproc interop in BOTH environments (v0.1 lesson, mandatory)**

Vitest side is covered by the tests below. Browser side:
```bash
cd frontend && npx vite optimize --force >/dev/null 2>&1 && node --input-type=module -e "
const m = (await import('./node_modules/.vite/deps/citeproc.js')).default;
const CSL = (m && m.default) ?? m;
console.log('Engine is function:', typeof CSL.Engine === 'function');
"
```
Expected: `Engine is function: true`. Use the same `(mod as any).default ?? mod` unwrap in citations.ts regardless, so both environments resolve identically.

- [ ] **Step 3: Write the failing formatter tests** (`citations.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { createCitationFormatter, STYLE_IDS } from './citations'
import type { CSLEntry } from './bibliography'

const ENTRIES: CSLEntry[] = [
  { id: 'smith2020', type: 'article-journal', title: 'A study',
    author: [{ family: 'Smith', given: 'John A.' }],
    issued: { 'date-parts': [[2020]] }, 'container-title': 'Nature' },
  { id: 'doe2021', type: 'book', title: 'Deep work',
    author: [{ family: 'Doe', given: 'Jane' }],
    issued: { 'date-parts': [[2021]] }, publisher: 'Acme' },
  { id: 'smith2020x', type: 'article-journal', title: 'Another study',
    author: [{ family: 'Smith', given: 'John A.' }],
    issued: { 'date-parts': [[2020]] }, 'container-title': 'Science' },
]

describe('createCitationFormatter (apa)', () => {
  it('formats a simple cluster and a multi-cite cluster', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    const { texts, bibliographyHtml } = f.format([
      { items: [{ key: 'smith2020' }] },
      { items: [{ key: 'smith2020' }, { key: 'doe2021' }] },
    ])
    expect(texts[0]).toContain('Smith')
    expect(texts[1]).toContain('Doe')
    expect(bibliographyHtml).toContain('csl-entry')
    expect(bibliographyHtml).toContain('csl-bib-body')
  })

  it('renders narrative, suppressed, and locator forms', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    const { texts } = f.format([
      { items: [{ key: 'smith2020' }], mode: 'composite' },
      { items: [{ key: 'smith2020', suppressAuthor: true }] },
      { items: [{ key: 'smith2020', prefix: 'see ', locator: '33', label: 'page' }] },
    ])
    expect(texts[0]).toMatch(/Smith \(2020[a-z]?\)/)
    expect(texts[1]).toMatch(/\(2020[a-z]?\)/)
    expect(texts[2]).toContain('see Smith')
    expect(texts[2]).toContain('p. 33')
  })

  it('disambiguates two same-author-same-year entries', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    const { texts } = f.format([
      { items: [{ key: 'smith2020' }] },
      { items: [{ key: 'smith2020x' }] },
    ])
    expect(texts[0]).not.toBe(texts[1]) // 2020a vs 2020b
  })

  it('returns empty bibliography for zero clusters', () => {
    const f = createCitationFormatter(ENTRIES, 'apa')
    expect(f.format([]).bibliographyHtml).toBe('')
  })

  it('every bundled style formats without throwing', () => {
    for (const id of STYLE_IDS) {
      const f = createCitationFormatter(ENTRIES, id)
      expect(f.format([{ items: [{ key: 'doe2021' }] }]).texts[0].length).toBeGreaterThan(0)
    }
  })

  it('unknown style id falls back to apa output', () => {
    const apa = createCitationFormatter(ENTRIES, 'apa').format([{ items: [{ key: 'doe2021' }] }])
    const fb = createCitationFormatter(ENTRIES, 'nope').format([{ items: [{ key: 'doe2021' }] }])
    expect(fb.texts[0]).toBe(apa.texts[0])
  })
})
```

- [ ] **Step 4: Run to verify FAIL**, then implement the formatter half of `citations.ts`:

```ts
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
      let processed = 0
      clusters.forEach((cluster, i) => {
        if (cluster.items.length === 0) return // caller-blanked cluster: keep '' at index i
        processed++
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
        for (const [index, html] of updates) texts[index] = html
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
```
Note the fresh engine per `format` call: it keeps the formatter stateless per render (repeat renders of the same document must not accumulate cluster history). Engine construction is a few ms; the App-level formatter is still cached across keystrokes (Task 8).

- [ ] **Step 5: Run to verify PASS** (`npx vitest run src/lib/citations.test.ts`), full `npm test` green, and `npm run build` succeeds (proves `?raw` imports bundle).

- [ ] **Step 6: Commit** — `git add frontend/src/assets frontend/src/lib/citations.* && git commit -m "feat: bundled CSL styles and citeproc citation formatter"`

---

