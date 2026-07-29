# Hermes v0.3 Citations & Bibliography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pandoc-style `[@key]` citations rendered through CSL with a per-document `.bib`, plus Zotero/Better-BibTeX integration (CAYW picker insertion, watched auto-export).

**Architecture:** All rendering stays in the frontend. A markdown-it inline rule tokenizes citation groups into indexed placeholders; after the HTML pass, citeproc-js formats the clusters in document order and a References section is appended. Go reads and watches the `.bib` (mtime polling goroutine) and proxies the CAYW picker. Spec: `docs/superpowers/specs/2026-07-29-citations-design.md`.

**Tech Stack:** citeproc (npm, the reference CSL engine), `@retorquere/bibtex-parser` (BBT's own parser), vendored CSL style/locale XML, markdown-it custom rule, Go net/http + goroutine watcher.

## Global Constraints

- TDD everywhere a test is practical: failing test → verify fail → implement → verify pass → commit.
- Error rule from the spec: errors render visibly in place; a broken or missing bibliography never blanks the preview. Unknown citekey renders as `[@key?]` in error styling.
- Documents without citations (and `render` calls without options) must render byte-identical to the v0.2 pipeline.
- Frontend commands run in `frontend/`; Go gates at repo root: `go test ./.`, `go build -o /dev/null .` (never `./...`), `gofmt -l` clean on touched files.
- After changing Go service exported APIs: `wails3 task common:generate:bindings`.
- CJS/ESM interop lesson from v0.1: any CJS dep (citeproc is one) must be import-verified in BOTH Vitest and the Vite browser pre-bundle (`node --input-type=module -e "..."` against `node_modules/.vite/deps/...` after `npx vite optimize --force`). Use the `(mod as any).default ?? mod` unwrap pattern if the environments disagree.
- API facts verified by probe (do not re-derive): `parse(bibtex)` → `{ errors, entries: [{ type, key, fields: { author: [{lastName, firstName}], title, journal, year, volume, pages, ... } }] }` (titles arrive sentence-cased, pages en-dashed). `new CSL.Engine({retrieveItem, retrieveLocale}, styleXML)`; `engine.processCitationCluster(citation, citationsPre, citationsPost)` → `[meta, [[index, html, citationID], ...]]` where updates may rewrite earlier clusters; narrative = `properties.mode: 'composite'` → `Smith (2020)`; suppress = item `'suppress-author': true` → `(2020)`; locator = item `{ locator: '33', label: 'page', prefix: 'see ' }` → `(see Smith, 2020, p. 33)`; `engine.makeBibliography()` → `[meta, htmlEntries[]]` (meta has `bibstart`/`bibend`).
- Bundled styles: `apa` (default), `chicago-author-date`, `ieee`, `vancouver`, `harvard` (file `harvard-cite-them-right.csl`); locale `en-US`. CSL styles are CC-BY-SA-3.0 — the vendored directory carries a LICENSE note.

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/frontmatter.ts` + `.test.ts` | Strip/parse the leading `---` block (bibliography, csl keys) |
| `frontend/src/lib/bibliography.ts` + `.test.ts` | `.bib` text → CSL-JSON entries via BBT parser + type/field mapping |
| `frontend/src/assets/csl/*.csl`, `locales-en-US.xml`, `LICENSE.md` | Vendored styles + locale |
| `frontend/src/lib/citations.ts` + `.test.ts` | markdown-it citation rule (parse) + `createCitationFormatter` (citeproc wrapper) |
| `frontend/src/lib/renderer.ts` + `renderer.test.ts` (modify) | Frontmatter stripping + two-phase citation pass |
| `frontend/src/Editor.svelte` (modify) | `insertAtCursor(text)` |
| `frontend/src/App.svelte` (modify) | Bib load/watch wiring, insert-citation flow, Cite button, toasts |
| `frontend/public/style.css` (modify) | `.citation`, `.cite-error`, `.csl-bib-body` styles |
| `zotero.go` + `zotero_test.go` | `PickCitations` (CAYW HTTP call, injectable base URL) |
| `documentservice.go` + `_test.go` (modify) | `ReadBibliography`, `WatchBibliography` (goroutine, injectable tick) |
| `menu.go`, `main.go` (modify) | Insert Citation… menu item, watcher event wiring |
| `docs/visual-test.md`, `docs/visual-test.bib` (modify/create) | Citations section for manual verification |

---

### Task 1: Frontmatter parsing

**Files:**
- Create: `frontend/src/lib/frontmatter.ts`
- Test: `frontend/src/lib/frontmatter.test.ts`

**Interfaces:**
- Produces: `parseFrontmatter(markdown: string): { body: string; bibliography?: string; csl?: string }`. `body` is the document with the frontmatter block removed (no leading blank line). Renderer (Task 5) and App (Task 8) both call exactly this.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from './frontmatter'

describe('parseFrontmatter', () => {
  it('extracts bibliography and csl and strips the block', () => {
    const doc = '---\nbibliography: refs.bib\ncsl: ieee\n---\n# Title\n'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBe('refs.bib')
    expect(fm.csl).toBe('ieee')
    expect(fm.body).toBe('# Title\n')
  })

  it('handles quoted values and extra whitespace', () => {
    const doc = '---\nbibliography:  "my refs.bib"\n---\nText'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBe('my refs.bib')
  })

  it('ignores unknown keys but still strips the block', () => {
    const doc = '---\ntitle: My Paper\n---\nText'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBeUndefined()
    expect(fm.body).toBe('Text')
  })

  it('returns the document unchanged when there is no frontmatter', () => {
    expect(parseFrontmatter('# Just a doc').body).toBe('# Just a doc')
  })

  it('does not treat a mid-document --- as frontmatter', () => {
    const doc = 'Intro\n\n---\nbibliography: x.bib\n---\n'
    const fm = parseFrontmatter(doc)
    expect(fm.bibliography).toBeUndefined()
    expect(fm.body).toBe(doc)
  })

  it('handles an unterminated frontmatter block as plain text', () => {
    const doc = '---\nbibliography: refs.bib\nno closing fence'
    expect(parseFrontmatter(doc).body).toBe(doc)
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `cd frontend && npx vitest run src/lib/frontmatter.test.ts` → module missing.

- [ ] **Step 3: Implement**

```ts
export interface Frontmatter {
  body: string
  bibliography?: string
  csl?: string
}

const KNOWN_KEYS = ['bibliography', 'csl'] as const

export function parseFrontmatter(markdown: string): Frontmatter {
  if (!markdown.startsWith('---\n') && markdown !== '---') {
    return { body: markdown }
  }
  const end = markdown.indexOf('\n---', 3)
  if (end === -1) return { body: markdown }
  const block = markdown.slice(4, end)
  // body starts after the closing fence line (and one following newline)
  const afterFence = markdown.indexOf('\n', end + 1)
  const body = afterFence === -1 ? '' : markdown.slice(afterFence + 1)

  const result: Frontmatter = { body }
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/)
    if (!m) continue
    const key = m[1] as (typeof KNOWN_KEYS)[number]
    if (!KNOWN_KEYS.includes(key)) continue
    result[key] = m[2].replace(/^["']|["']$/g, '')
  }
  return result
}
```

- [ ] **Step 4: Run to verify PASS**, then full `npm test` still green.

- [ ] **Step 5: Commit** — `git add frontend/src/lib/frontmatter.* && git commit -m "feat: frontmatter parsing for bibliography and csl keys"`

---

### Task 2: BibTeX → CSL-JSON (bibliography.ts)

**Files:**
- Create: `frontend/src/lib/bibliography.ts`, `frontend/src/lib/bibliography.test.ts`, `frontend/src/lib/fixtures/test-library.bib`
- Modify: `frontend/package.json` (deps)

**Interfaces:**
- Produces: `parseBib(text: string): { entries: CSLEntry[]; warnings: string[] }` where `CSLEntry` is CSL-JSON (`{ id, type, title?, author?: {family?, given?, literal?}[], issued?: {'date-parts': number[][]}, 'container-title'?, page?, volume?, issue?, publisher?, 'publisher-place'?, DOI?, URL? }`). `id` is the BibTeX key. Tasks 3/5/8 consume `CSLEntry[]`.

- [ ] **Step 1: Install deps** — `cd frontend && npm install @retorquere/bibtex-parser citeproc` (citeproc installed here so Task 3 starts clean).

- [ ] **Step 2: Create the fixture** `frontend/src/lib/fixtures/test-library.bib`:

```bibtex
@article{smith2020,
  author  = {Smith, John A. and Doe, Jane},
  title   = {A Study of Things},
  journal = {Nature},
  year    = {2020},
  volume  = {5},
  number  = {2},
  pages   = {10--20},
  doi     = {10.1000/xyz}
}
@book{doe2021,
  author    = {Doe, Jane},
  title     = {Deep Work on Things},
  publisher = {Acme Press},
  address   = {Boston},
  year      = {2021}
}
@incollection{smith2020b,
  author    = {Smith, John A.},
  title     = {Another Study},
  booktitle = {Collected Studies},
  editor    = {Editor, Ed},
  publisher = {Acme Press},
  year      = {2020},
  pages     = {100--120}
}
@inproceedings{jones2019,
  author    = {Jones, Carol},
  title     = {Conference Findings},
  booktitle = {Proc. of Things},
  year      = {2019}
}
@misc{websource2022,
  author = {{Acme Corporation}},
  title  = {Web Source},
  year   = {2022},
  url    = {https://example.com/report}
}
```

- [ ] **Step 3: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBib } from './bibliography'

const BIB = readFileSync(join(__dirname, 'fixtures/test-library.bib'), 'utf8')

describe('parseBib', () => {
  const { entries, warnings } = parseBib(BIB)
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]))

  it('parses all entries without warnings', () => {
    expect(entries.length).toBe(5)
    expect(warnings).toEqual([])
  })

  it('maps an article with authors, container, pages, volume, issue, DOI', () => {
    const e = byId['smith2020']
    expect(e.type).toBe('article-journal')
    expect(e.author).toEqual([
      { family: 'Smith', given: 'John A.' },
      { family: 'Doe', given: 'Jane' },
    ])
    expect(e['container-title']).toBe('Nature')
    expect(e.issued).toEqual({ 'date-parts': [[2020]] })
    expect(e.page).toMatch(/10[-–]20/)
    expect(e.volume).toBe('5')
    expect(e.issue).toBe('2')
    expect(e.DOI).toBe('10.1000/xyz')
  })

  it('maps book, chapter, and conference types', () => {
    expect(byId['doe2021'].type).toBe('book')
    expect(byId['doe2021'].publisher).toBe('Acme Press')
    expect(byId['doe2021']['publisher-place']).toBe('Boston')
    expect(byId['smith2020b'].type).toBe('chapter')
    expect(byId['smith2020b']['container-title']).toBe('Collected studies')
    expect(byId['jones2019'].type).toBe('paper-conference')
  })

  it('maps a corporate author to a literal name', () => {
    expect(byId['websource2022'].author).toEqual([{ literal: 'Acme Corporation' }])
    expect(byId['websource2022'].URL).toBe('https://example.com/report')
  })

  it('reports malformed input as warnings, keeping good entries', () => {
    const r = parseBib('@article{ok, title={Fine}, year={2020}}\n@article{broken')
    expect(r.entries.map((e) => e.id)).toContain('ok')
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})
```

Note: BBT sentence-cases titles ("Collected studies") — assert what the parser actually produces; if an assertion mismatches on casing, fix the assertion, not the parser.

- [ ] **Step 4: Run to verify FAIL**, then implement:

```ts
import { parse } from '@retorquere/bibtex-parser'

export interface CSLName {
  family?: string
  given?: string
  literal?: string
}

export interface CSLEntry {
  id: string
  type: string
  title?: string
  author?: CSLName[]
  editor?: CSLName[]
  issued?: { 'date-parts': number[][] }
  'container-title'?: string
  page?: string
  volume?: string
  issue?: string
  publisher?: string
  'publisher-place'?: string
  DOI?: string
  URL?: string
}

const TYPE_MAP: Record<string, string> = {
  article: 'article-journal',
  book: 'book',
  incollection: 'chapter',
  inbook: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  techreport: 'report',
  unpublished: 'manuscript',
  online: 'webpage',
  misc: 'document',
}

interface BBTCreator {
  lastName?: string
  firstName?: string
  name?: string
  literal?: string
}

function mapNames(creators: BBTCreator[] | undefined): CSLName[] | undefined {
  if (!creators?.length) return undefined
  return creators.map((c) => {
    const literal = c.literal ?? c.name
    if (literal) return { literal }
    if (c.lastName && !c.firstName) return c.lastName.includes(' ')
      ? { literal: c.lastName }
      : { family: c.lastName }
    return { family: c.lastName, given: c.firstName }
  })
}

export function parseBib(text: string): { entries: CSLEntry[]; warnings: string[] } {
  const parsed = parse(text)
  const warnings = parsed.errors.map((e: { error?: string }) =>
    typeof e === 'string' ? e : (e.error ?? JSON.stringify(e)),
  )
  const entries: CSLEntry[] = []
  for (const raw of parsed.entries) {
    const f = raw.fields as Record<string, unknown>
    const entry: CSLEntry = {
      id: raw.key,
      type: TYPE_MAP[raw.type] ?? 'document',
      title: f.title as string | undefined,
      author: mapNames(f.author as BBTCreator[] | undefined),
      editor: mapNames(f.editor as BBTCreator[] | undefined),
      'container-title': (f.journal ?? f.booktitle) as string | undefined,
      page: f.pages as string | undefined,
      volume: f.volume as string | undefined,
      issue: f.number as string | undefined,
      publisher: f.publisher as string | undefined,
      'publisher-place': f.address as string | undefined,
      DOI: f.doi as string | undefined,
      URL: f.url as string | undefined,
    }
    const year = parseInt(f.year as string, 10)
    if (!Number.isNaN(year)) entry.issued = { 'date-parts': [[year]] }
    entries.push(entry)
  }
  return { entries, warnings }
}
```

Contingency: if the corporate-author fixture (`{{Acme Corporation}}`) arrives from the parser in a different shape than `BBTCreator` above, `console.log` the raw creator once, adapt `mapNames` minimally, and record the actual shape in your report.

- [ ] **Step 5: Run to verify PASS**; `npm run check` still 0 errors.

- [ ] **Step 6: Commit** — `git add frontend/src/lib/bibliography.* frontend/src/lib/fixtures frontend/package*.json && git commit -m "feat: bibtex to CSL-JSON parsing via Better BibTeX parser"`

---

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

### Task 4: Citation syntax parsing (markdown-it rule)

**Files:**
- Modify: `frontend/src/lib/citations.ts` (add parser half), `frontend/src/lib/citations.test.ts` (add parser tests)

**Interfaces:**
- Consumes: `CitationCluster`/`CitationItem` types from Task 3.
- Produces (Task 5 relies on these exactly):
  - `citationPlugin(md: MarkdownIt): void` — registers inline rule `citation` BEFORE the `link` rule (bracketed groups) and a text-level rule for bare `@key`. During render, each citation emits `<span class="citation" data-cite-index="N">ESCAPED_RAW</span>` and pushes its `CitationCluster` onto `env.citations` (creating the array if absent).
  - `KEY_RE` (exported for tests): citekey = `[A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*` (Pandoc's charset).
  - Locator recognition inside a bracketed item's suffix: `, p. 33` / `, pp. 10-20` → label `page`; `, chap. 3`/`, chapter 3` → `chapter`; `, sec. 2`/`, section 2` → `section`; bare `, 33` → `page`. Anything else stays a plain `suffix`.

- [ ] **Step 1: Write the failing parser tests** (append to `citations.test.ts`)

```ts
import MarkdownIt from 'markdown-it'
import { citationPlugin } from './citations'
import type { CitationCluster } from './citations'

function parseDoc(src: string): { html: string; clusters: CitationCluster[] } {
  const md = new MarkdownIt({ html: false })
  md.use(citationPlugin)
  const env: { citations?: CitationCluster[] } = {}
  const html = md.render(src, env)
  return { html, clusters: env.citations ?? [] }
}

describe('citationPlugin parsing', () => {
  it('parses a simple bracketed citation into a placeholder + cluster', () => {
    const { html, clusters } = parseDoc('As shown [@smith2020].')
    expect(html).toContain('data-cite-index="0"')
    expect(clusters).toEqual([{ items: [{ key: 'smith2020' }] }])
  })

  it('parses multiple keys with semicolons', () => {
    const { clusters } = parseDoc('[@a2020; @b2021]')
    expect(clusters[0].items.map((i) => i.key)).toEqual(['a2020', 'b2021'])
  })

  it('parses prefix, locator, and label', () => {
    const { clusters } = parseDoc('[see @smith2020, pp. 33-35]')
    expect(clusters[0].items[0]).toMatchObject({
      key: 'smith2020', prefix: 'see ', locator: '33-35', label: 'page',
    })
  })

  it('parses suppress-author', () => {
    const { clusters } = parseDoc('Smith said blah [-@smith2020].')
    expect(clusters[0].items[0].suppressAuthor).toBe(true)
  })

  it('parses a narrative citation as composite mode', () => {
    const { clusters } = parseDoc('@smith2020 shows the effect.')
    expect(clusters[0]).toMatchObject({ items: [{ key: 'smith2020' }], mode: 'composite' })
  })

  it('does not fire on emails or mid-word @', () => {
    const { clusters, html } = parseDoc('mail me at test@example.com')
    expect(clusters).toEqual([])
    expect(html).toContain('test@example.com')
  })

  it('leaves normal links and brackets alone', () => {
    const { clusters, html } = parseDoc('[a link](https://x.y) and [plain brackets]')
    expect(clusters).toEqual([])
    expect(html).toContain('<a href')
  })

  it('does not fire inside code spans', () => {
    const { clusters } = parseDoc('`[@smith2020]`')
    expect(clusters).toEqual([])
  })

  it('numbers clusters in document order', () => {
    const { html, clusters } = parseDoc('[@a1] then @b2 then [@c3]')
    expect(clusters.length).toBe(3)
    expect(html).toContain('data-cite-index="1"')
    expect(html).toContain('data-cite-index="2"')
  })
})
```

- [ ] **Step 2: Run to verify FAIL**, then implement (append to `citations.ts`):

```ts
import type MarkdownIt from 'markdown-it'
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs'

export const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*/

const LOCATOR_RE =
  /^,\s*(?:(pp?\.|pages?)\s*|(chap(?:ter)?\.?)\s*|(sec(?:tion)?\.?)\s*)?(\d[\d\s,–-]*)\s*$/

function splitLocator(suffix: string): { locator?: string; label?: string; suffix?: string } {
  const m = suffix.match(LOCATOR_RE)
  if (!m) return suffix ? { suffix } : {}
  const label = m[2] ? 'chapter' : m[3] ? 'section' : 'page'
  return { locator: m[4].trim(), label }
}

function parseBracketContent(content: string): CitationItem[] | null {
  const items: CitationItem[] = []
  for (const part of content.split(';')) {
    const at = part.indexOf('@')
    if (at === -1) return null
    let prefix = part.slice(0, at)
    let suppressAuthor = false
    if (prefix.trimEnd().endsWith('-')) {
      prefix = prefix.trimEnd().slice(0, -1)
      suppressAuthor = true
    }
    const rest = part.slice(at + 1)
    const keyMatch = rest.match(KEY_RE)
    if (!keyMatch) return null
    // trailing sentence punctuation is not part of the key
    const key = keyMatch[0].replace(/[.:#?]+$/, '')
    if (!key) return null
    const after = rest.slice(key.length)
    const item: CitationItem = { key }
    const trimmedPrefix = prefix.replace(/^\s+/, '')
    if (trimmedPrefix) item.prefix = trimmedPrefix
    if (suppressAuthor) item.suppressAuthor = true
    Object.assign(item, splitLocator(after.trimEnd()))
    items.push(item)
  }
  return items.length ? items : null
}

function pushCitation(
  state: StateInline,
  cluster: CitationCluster,
  raw: string,
): void {
  const env = state.env as { citations?: CitationCluster[] }
  env.citations ??= []
  const index = env.citations.length
  env.citations.push(cluster)
  const token = state.push('citation', '', 0)
  token.meta = { index }
  token.content = raw
}

function bracketRule(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state
  if (src[pos] !== '[') return false
  const close = src.indexOf(']', pos)
  if (close === -1) return false
  const content = src.slice(pos + 1, close)
  if (!content.includes('@')) return false
  const items = parseBracketContent(content)
  if (!items) return false
  if (!silent) pushCitation(state, { items }, src.slice(pos, close + 1))
  state.pos = close + 1
  return true
}

function narrativeRule(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state
  if (src[pos] !== '@') return false
  // must not be mid-word (emails, handles-in-words)
  const before = pos === 0 ? '' : src[pos - 1]
  if (before && /[\w.\-@]/.test(before)) return false
  const keyMatch = src.slice(pos + 1).match(KEY_RE)
  if (!keyMatch) return false
  const key = keyMatch[0].replace(/[.:#?]+$/, '')
  if (!key) return false
  if (!silent)
    pushCitation(state, { items: [{ key }], mode: 'composite' }, `@${key}`)
  state.pos = pos + 1 + key.length
  return true
}

export function citationPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('link', 'citation', bracketRule)
  md.inline.ruler.before('emphasis', 'citation_narrative', narrativeRule)
  md.renderer.rules.citation = (tokens, idx) => {
    const t = tokens[idx]
    return `<span class="citation" data-cite-index="${t.meta.index}">${md.utils.escapeHtml(t.content)}</span>`
  }
  md.renderer.rules.citation_narrative = md.renderer.rules.citation
}
```
Both rules must emit the SAME token renderer output; register `citation_narrative` tokens as `state.push('citation_narrative', '', 0)` in `narrativeRule` (adjust `pushCitation` to take the token type as a parameter). Clean up the duplicated key-truncation lines while implementing — the sketch above errs on the side of explicitness; the tests are the contract.

- [ ] **Step 3: Run to verify PASS**; iterate on the rule until every listed test is green. The code-span test passes for free (markdown-it tokenizes code spans before inline rules run over their content).

- [ ] **Step 4: Full suite + `npm run check`**, then commit — `git commit -m "feat: pandoc-subset citation syntax parsing"`

---

### Task 5: Renderer integration (two-phase pass)

**Files:**
- Modify: `frontend/src/lib/renderer.ts`, `frontend/src/lib/renderer.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` (Task 1), `citationPlugin`, `createCitationFormatter`, `CitationFormatter`, `CitationCluster` (Tasks 3/4).
- Produces: `render(markdown: string, opts?: { formatter?: CitationFormatter })` — still returns `string`. Behavior: frontmatter always stripped; without `opts.formatter`, citations render as their raw text in `.citation` spans (no error, no bibliography); with a formatter, placeholders are substituted and a References section is appended; clusters containing a key the formatter cannot resolve render the whole group as `[@key?]`-style error text in `.cite-error`. Add `formatterResolves(formatter, key)` — no: instead `createCitationFormatter` gains `has(key: string): boolean` (add to the interface in citations.ts; one-line Map lookup).

- [ ] **Step 1: Write the failing tests** (append to `renderer.test.ts`)

```ts
import { createCitationFormatter } from './citations'
import type { CSLEntry } from './bibliography'

const ENTRIES: CSLEntry[] = [
  { id: 'smith2020', type: 'article-journal', title: 'A study',
    author: [{ family: 'Smith', given: 'John A.' }],
    issued: { 'date-parts': [[2020]] }, 'container-title': 'Nature' },
]
const FORMATTER = createCitationFormatter(ENTRIES, 'apa')

describe('render: citations', () => {
  it('strips frontmatter with or without a formatter', () => {
    const doc = '---\nbibliography: refs.bib\n---\n# Title'
    expect(render(doc)).toContain('<h1>Title</h1>')
    expect(render(doc)).not.toContain('bibliography')
  })

  it('renders formatted citations and a References section', () => {
    const html = render('Blah [@smith2020].', { formatter: FORMATTER })
    expect(html).toContain('Smith')
    expect(html).toContain('2020')
    expect(html).toContain('<h2>References</h2>')
    expect(html).toContain('csl-entry')
  })

  it('renders raw citation text without a formatter, no References', () => {
    const html = render('Blah [@smith2020].')
    expect(html).toContain('[@smith2020]')
    expect(html).not.toContain('References')
  })

  it('renders unknown keys as in-place errors, rest of doc fine', () => {
    const html = render('Good [@smith2020]. Bad [@nope2000].', { formatter: FORMATTER })
    expect(html).toContain('cite-error')
    expect(html).toContain('[@nope2000?]')
    expect(html).toMatch(/Smith.*2020/)
  })

  it('adds no References section when the document has no citations', () => {
    expect(render('Just text.', { formatter: FORMATTER })).not.toContain('References')
  })

  it('renders documents without citations identically to the plain pipeline', () => {
    const doc = '# H\n\nSome *text* with $x^2$ and\n\n```vega-lite\n{"mark": "bar"}\n```\n'
    expect(render(doc, { formatter: FORMATTER })).toBe(render(doc))
  })
})
```

- [ ] **Step 2: Run to verify FAIL**, then implement in `renderer.ts`:

```ts
import { parseFrontmatter } from './frontmatter'
import { citationPlugin, type CitationFormatter, type CitationCluster } from './citations'

md.use(citationPlugin)

export interface RenderOptions {
  formatter?: CitationFormatter
}

export function render(markdown: string, opts?: RenderOptions): string {
  const { body } = parseFrontmatter(markdown)
  const env: { citations?: CitationCluster[] } = {}
  let html = md.render(body, env)
  const clusters = env.citations ?? []
  const formatter = opts?.formatter
  if (!formatter || clusters.length === 0) return html

  const { texts, bibliographyHtml } = formatter.format(
    clusters.map((c) => resolvable(formatter, c) ? c : { items: [] }),
  )
  html = html.replace(
    /<span class="citation" data-cite-index="(\d+)">(.*?)<\/span>/g,
    (whole, idx: string, raw: string) => {
      const i = Number(idx)
      const cluster = clusters[i]
      if (!cluster || !resolvable(formatter, cluster)) {
        const marked = cluster
          ? cluster.items.map((it) => `[@${it.key}${formatter.has(it.key) ? '' : '?'}]`).join(' ')
          : raw
        return `<span class="cite-error">${marked}</span>`
      }
      return `<span class="citation">${texts[i]}</span>`
    },
  )
  if (clusters.some((c) => resolvable(formatter, c))) {
    html += `<h2>References</h2>\n${bibliographyHtml}\n`
  }
  return html
}

function resolvable(f: CitationFormatter, c: CitationCluster): boolean {
  return c.items.length > 0 && c.items.every((it) => f.has(it.key))
}
```
Implementation notes: `formatter.format` must tolerate a `{ items: [] }` cluster (skip it, keep index alignment — adjust Task 3's loop to `if (cluster.items.length === 0) { pre-skip; return }` style, keeping `texts[i] = ''`). The `.replace` callback's `raw` group never spans other spans because the placeholder content is escaped text only.

- [ ] **Step 3: Run to verify PASS**, full suite, `npm run check`, `npm run build`.

- [ ] **Step 4: Commit** — `git commit -m "feat: two-phase citation rendering with References section"`

---

### Task 6: Go — ReadBibliography + watcher

**Files:**
- Modify: `documentservice.go`, `documentservice_test.go`

**Interfaces:**
- Produces (bindings used in Task 8): `ReadBibliography(path, docPath string) (string, error)`; `WatchBibliography(path, docPath string)` (empty `path` stops watching). Internal: `watchTick time.Duration` field (default `2 * time.Second`), `emitBibChanged func()` field (defaults to Wails emit, injectable in tests), `watchCancel context.CancelFunc` + `watchMu sync.Mutex`.
- Event emitted: `bib:changed` (no payload).

- [ ] **Step 1: Write the failing tests** (append to `documentservice_test.go`)

```go
func TestReadBibliographyResolvesRelativeToDocument(t *testing.T) {
	s := newTestService(t)
	dir := t.TempDir()
	docPath := filepath.Join(dir, "paper.md")
	bibPath := filepath.Join(dir, "refs.bib")
	if err := os.WriteFile(bibPath, []byte("@article{x, year={2020}}"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := s.ReadBibliography("refs.bib", docPath)
	if err != nil {
		t.Fatalf("relative read: %v", err)
	}
	if got != "@article{x, year={2020}}" {
		t.Errorf("unexpected content %q", got)
	}

	got, err = s.ReadBibliography(bibPath, docPath) // absolute passes through
	if err != nil || got == "" {
		t.Errorf("absolute read failed: %v", err)
	}

	if _, err := s.ReadBibliography("missing.bib", docPath); err == nil {
		t.Error("want error for missing bibliography")
	}
}

func TestWatchBibliographyEmitsOnChange(t *testing.T) {
	s := newTestService(t)
	s.watchTick = 10 * time.Millisecond
	dir := t.TempDir()
	docPath := filepath.Join(dir, "paper.md")
	bibPath := filepath.Join(dir, "refs.bib")
	if err := os.WriteFile(bibPath, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	var emitted atomic.Int32
	s.emitBibChanged = func() { emitted.Add(1) }

	s.WatchBibliography("refs.bib", docPath)
	time.Sleep(30 * time.Millisecond) // no change yet
	if emitted.Load() != 0 {
		t.Fatalf("emitted %d before any change", emitted.Load())
	}

	// mtime resolution can be coarse; change size too
	if err := os.WriteFile(bibPath, []byte("v2 longer"), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for emitted.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if emitted.Load() == 0 {
		t.Fatal("no emit after change")
	}

	s.WatchBibliography("", docPath) // stop
}

func TestWatchBibliographySelfHealsMissingFile(t *testing.T) {
	s := newTestService(t)
	s.watchTick = 10 * time.Millisecond
	dir := t.TempDir()
	docPath := filepath.Join(dir, "paper.md")
	var emitted atomic.Int32
	s.emitBibChanged = func() { emitted.Add(1) }

	s.WatchBibliography("refs.bib", docPath) // file doesn't exist yet
	time.Sleep(30 * time.Millisecond)
	if err := os.WriteFile(filepath.Join(dir, "refs.bib"), []byte("now"), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for emitted.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if emitted.Load() == 0 {
		t.Fatal("no emit when file appeared")
	}
	s.WatchBibliography("", docPath)
}
```
(New imports in the test file: `"sync/atomic"`, `"time"`.)

- [ ] **Step 2: Run to verify FAIL** (`go test ./. -run 'TestReadBibliography|TestWatchBibliography'`), then implement in `documentservice.go`:

Struct additions:
```go
	watchTick      time.Duration
	emitBibChanged func()
	watchMu        sync.Mutex
	watchCancel    context.CancelFunc
```
`NewDocumentService` sets `watchTick: 2 * time.Second`.

```go
func (s *DocumentService) resolveAgainstDoc(path, docPath string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(filepath.Dir(docPath), path)
}

func (s *DocumentService) ReadBibliography(path, docPath string) (string, error) {
	data, err := os.ReadFile(s.resolveAgainstDoc(path, docPath))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WatchBibliography (re)arms the single bibliography watcher. An empty path
// stops watching. The goroutine polls mtime+size and notifies on change; a
// missing file keeps polling and notifies when it appears.
func (s *DocumentService) WatchBibliography(path, docPath string) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	if s.watchCancel != nil {
		s.watchCancel()
		s.watchCancel = nil
	}
	if path == "" {
		return
	}
	resolved := s.resolveAgainstDoc(path, docPath)
	ctx, cancel := context.WithCancel(context.Background())
	s.watchCancel = cancel

	notify := s.emitBibChanged
	if notify == nil {
		notify = func() { application.Get().Event.Emit("bib:changed") }
	}

	go func() {
		var lastMod time.Time
		var lastSize int64
		known := false
		if info, err := os.Stat(resolved); err == nil {
			lastMod, lastSize, known = info.ModTime(), info.Size(), true
		}
		ticker := time.NewTicker(s.watchTick)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				info, err := os.Stat(resolved)
				if err != nil {
					known = false
					continue
				}
				if !known || !info.ModTime().Equal(lastMod) || info.Size() != lastSize {
					lastMod, lastSize, known = info.ModTime(), info.Size(), true
					notify()
				}
			}
		}
	}()
}
```
Wait — the initial-stat logic marks an existing file as `known`, so the first tick only notifies on change; a file appearing later (`!known`) notifies immediately. That matches both tests. New imports: `"context"`, `"sync"`, `"time"`.

- [ ] **Step 3: Run to verify PASS** (all Go tests), `gofmt -l documentservice.go` clean, `go build -o /dev/null .`.

- [ ] **Step 4: Commit** — `git commit -m "feat: bibliography read and mtime watcher with bib:changed event"`

---

### Task 7: Go — CAYW picker + menu item + bindings

**Files:**
- Create: `zotero.go`, `zotero_test.go`
- Modify: `menu.go`, `documentservice.go` (delegate method), `frontend/bindings` (regenerated)

**Interfaces:**
- Produces: binding `PickCitations() (string, error)` on DocumentService — returns the Pandoc-format string from CAYW ("" when the user cancels); error when Zotero/BBT is unreachable. Internal: `caywBase string` field on DocumentService (default `http://127.0.0.1:23119`), injectable for tests. Menu: File → Insert Citation… (`cmdorctrl+shift+c`) emitting `menu:insert-citation` (no payload).

- [ ] **Step 1: Write the failing tests** (`zotero_test.go`)

```go
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPickCitationsReturnsCAYWResult(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/better-bibtex/cayw" || r.URL.Query().Get("format") != "pandoc" {
			t.Errorf("unexpected request: %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_, _ = w.Write([]byte("[@smith2020; @doe2021]"))
	}))
	defer srv.Close()

	s := newTestService(t)
	s.caywBase = srv.URL
	got, err := s.PickCitations()
	if err != nil {
		t.Fatalf("PickCitations: %v", err)
	}
	if got != "[@smith2020; @doe2021]" {
		t.Errorf("got %q", got)
	}
}

func TestPickCitationsEmptyOnCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("")) // CAYW returns empty on cancel
	}))
	defer srv.Close()
	s := newTestService(t)
	s.caywBase = srv.URL
	got, err := s.PickCitations()
	if err != nil || got != "" {
		t.Errorf("want empty no-error, got %q err %v", got, err)
	}
}

func TestPickCitationsErrorWhenUnreachable(t *testing.T) {
	s := newTestService(t)
	s.caywBase = "http://127.0.0.1:1" // nothing listens here
	if _, err := s.PickCitations(); err == nil {
		t.Error("want error when Zotero is unreachable")
	}
}
```

- [ ] **Step 2: Run to verify FAIL**, then implement `zotero.go`:

```go
package main

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// PickCitations opens Zotero's citation picker via Better BibTeX's CAYW
// endpoint and returns the chosen citations in Pandoc format. The timeout is
// long because the user is interacting with the picker; an empty response
// means they cancelled.
func (s *DocumentService) PickCitations() (string, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(s.caywBase + "/better-bibtex/cayw?format=pandoc")
	if err != nil {
		return "", fmt.Errorf("zotero picker unavailable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("zotero picker returned %s", resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}
```
Add `caywBase string` to the DocumentService struct; `NewDocumentService` sets `caywBase: "http://127.0.0.1:23119"`.

- [ ] **Step 3: Menu item** (`menu.go`, in the File submenu after "Open Recent" — before Save):

```go
	file.Add("Insert Citation…").SetAccelerator("shift+cmdorctrl+c").OnClick(func(*application.Context) {
		app.Event.Emit("menu:insert-citation")
	})
```

- [ ] **Step 4: Gates + bindings** — `go test ./.` all green, `gofmt -l` clean, `go build -o /dev/null .`, then `wails3 task common:generate:bindings`; confirm `PickCitations`, `ReadBibliography`, `WatchBibliography` appear in `frontend/bindings/hermes/documentservice.ts`.

- [ ] **Step 5: Commit** — `git add zotero.go zotero_test.go menu.go documentservice.go frontend/bindings && git commit -m "feat: Zotero CAYW picker binding and Insert Citation menu item"`

---

### Task 8: Editor insertion + App wiring

**Files:**
- Modify: `frontend/src/Editor.svelte`, `frontend/src/App.svelte`, `frontend/public/style.css`

**Interfaces:**
- Consumes: everything above — `parseFrontmatter`, `parseBib`, `createCitationFormatter` (+ `has`), `render(markdown, { formatter })`, bindings `ReadBibliography`/`WatchBibliography`/`PickCitations`, events `bib:changed`/`menu:insert-citation`.
- Produces: the working feature. `Editor.insertAtCursor(text: string)` — inserts at the cursor (replacing any selection), cursor lands after the insertion, editor refocused.

- [ ] **Step 1: Editor.svelte — add below `setContent`:**

```ts
export function insertAtCursor(text: string): void {
  view.dispatch(view.state.replaceSelection(text))
  view.focus()
}
```

- [ ] **Step 2: App.svelte — bibliography state + wiring.** Script additions:

```ts
import { parseFrontmatter } from './lib/frontmatter'
import { parseBib } from './lib/bibliography'
import { createCitationFormatter, type CitationFormatter } from './lib/citations'

let formatter = $state<CitationFormatter | undefined>(undefined)
let bibPath = $state<string | null>(null)

const fm = $derived(parseFrontmatter(content))

// Reload the bibliography when the document's frontmatter changes it,
// when the document path changes, or on bib:changed from the watcher.
async function reloadBibliography() {
  const wanted = fm.bibliography ?? null
  bibPath = wanted
  if (!wanted || !path) {
    formatter = undefined
    void DocumentService.WatchBibliography('', path ?? '')
    return
  }
  try {
    const text = await DocumentService.ReadBibliography(wanted, path)
    const { entries, warnings } = parseBib(text)
    if (warnings.length) toast(`Bibliography: ${warnings.length} entr${warnings.length === 1 ? 'y' : 'ies'} could not be parsed`)
    formatter = createCitationFormatter(entries, fm.csl ?? 'apa')
  } catch {
    formatter = undefined
    toast(`Bibliography not found: ${wanted}`)
  }
  void DocumentService.WatchBibliography(wanted, path)
}

$effect(() => {
  void fm.bibliography
  void fm.csl
  void path
  void reloadBibliography()
})

async function insertCitation() {
  try {
    const picked = await DocumentService.PickCitations()
    if (picked) editor.insertAtCursor(picked)
  } catch {
    toast("Zotero (with Better BibTeX) isn't running")
  }
}
```
Preview rendering: change both render call sites (`updatePreview` debounce and `loadDocument`) to pass `{ formatter }`, and add an effect so a formatter change re-renders the current content:

```ts
import { untrack } from 'svelte'

// Re-render when the FORMATTER changes (bib loaded/reloaded, style change).
// content is read untracked: content changes flow through the debounced
// typing path, not this immediate effect.
$effect(() => {
  void formatter
  html = render(untrack(() => content), { formatter })
})
```
Update the two existing render call sites to pass the formatter: `updatePreview`'s body becomes `html = render(text, { formatter })` (the closure reads the latest `$state` value at call time), and `loadDocument`'s direct call becomes `html = render(docContent, { formatter })` — at load time the new document's bibliography may not be loaded yet, which is fine: the effect above re-renders when `reloadBibliography` lands.

Events in `onMount`:
```ts
Events.On('bib:changed', () => void reloadBibliography())
Events.On('menu:insert-citation', () => void insertCitation())
```
Toolbar: add `<button onclick={() => void insertCitation()}>Cite</button>` after Save. Unknown `csl` id toast: in `reloadBibliography`, after computing the formatter, `if (fm.csl && !STYLE_IDS.includes(fm.csl)) toast(\`Unknown citation style "${fm.csl}" — using APA\`)` (import `STYLE_IDS`).

- [ ] **Step 3: Styles** (`frontend/public/style.css`):

```css
.cite-error {
  color: #cc0000; background: #fff5f5; border-radius: 3px; padding: 0 3px;
}
.preview-pane .csl-bib-body { line-height: 1.7; }
.preview-pane .csl-entry { margin-bottom: 0.5em; }
```
And add `.csl-entry` to the print stylesheet's `break-inside: avoid` list.

- [ ] **Step 4: Gates** — `npm test`, `npm run check` (0 errors; investigate any new warnings), `go build -o /dev/null .`, `wails3 build`. Do NOT launch the GUI.

- [ ] **Step 5: Commit** — `git commit -m "feat: bibliography wiring, Cite button, and citation insertion"`

---

### Task 9: Visual test document + docs

**Files:**
- Modify: `docs/visual-test.md`, `CLAUDE.md`
- Create: `docs/visual-test.bib`

**Interfaces:** none new — this task packages manual verification.

- [ ] **Step 1: Create `docs/visual-test.bib`** with `smith2020`, `doe2021`, and `smith2020x` entries (reuse Task 2's fixture content, adding a second Smith 2020 article for disambiguation).

- [ ] **Step 2: Extend `docs/visual-test.md`**: add frontmatter (`bibliography: visual-test.bib`, `csl: apa`) at the very top, and a new section 9 before the intentional-errors section:

```markdown
## 9. Citations

A simple citation [@smith2020], a multi-cite [@smith2020; @doe2021], a
narrative citation: @doe2021 argues the point. Suppressed author [-@smith2020],
with locator [see @doe2021, pp. 33-35], and disambiguation [@smith2020; @smith2020x].
An unknown key must show an inline error: [@notakey1999].

A References section should appear at the end of this document, before nothing —
check it lists Smith (2020a, 2020b) and Doe (2021), and that ⌘E includes it in
the PDF without splitting entries across pages.
```
Renumber the intentional-errors section to 10 and add the unknown-key line above to its checklist sentence if needed.

- [ ] **Step 3: CLAUDE.md**: in the architecture section's frontend-pipeline bullet, add one sentence: citations are parsed by `lib/citations.ts` (markdown-it rule + citeproc-js formatter), bibliography data comes from a frontmatter-named `.bib` read/watched through Go (`bib:changed`), and Zotero insertion uses BBT's CAYW via `PickCitations`.

- [ ] **Step 4: Gates + commit** — full frontend + Go gates; `git commit -m "docs: citations section in visual test document"`

---

### Task 10: Release v0.3.0

**Gate: run only after the human has completed the manual GUI verification** (picker round-trip, BBT auto-export refresh, PDF with References, visual-test section 9).

- [ ] **Step 1: CHANGELOG.md** — new `[0.3.0] - <date>` section under `[Unreleased]`: Added — Pandoc-subset citations (`[@key]`, narrative, suppress, locators), per-document `.bib` via frontmatter, five bundled CSL styles, References section in preview and PDF, Zotero/Better BibTeX integration (CAYW picker via Cite button / ⌘⇧C, watched auto-export refresh). Note citeproc-js AGPL licensing in a "Notes" line.
- [ ] **Step 2: ROADMAP.md** — mark v0.3.0 released with a one-line summary; keep future ideas in backlog.
- [ ] **Step 3: `build/config.yml`** — version `0.3.0`; run `wails3 task common:update:build-assets`; verify Info.plist shows 0.3.0.
- [ ] **Step 4: Full gate** — `cd frontend && npm test && npm run check`, `go test ./. && go build -o /dev/null .`, `wails3 build`.
- [ ] **Step 5: Commit + tag** — `git commit -m "Release v0.3.0"` and `git tag -a v0.3.0 -m "Hermes v0.3.0 — citations and bibliography"`.
