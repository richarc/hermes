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

