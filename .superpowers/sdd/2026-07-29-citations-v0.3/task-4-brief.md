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

