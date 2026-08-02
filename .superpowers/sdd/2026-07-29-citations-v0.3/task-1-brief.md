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

