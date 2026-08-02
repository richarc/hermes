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

