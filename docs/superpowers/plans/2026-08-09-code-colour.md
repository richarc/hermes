# Colour for Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give fenced code colour in the editor and the preview, from one table, so the two cannot drift.

**Architecture:** One exported table maps Lezer tags to palette roles. The editor derives a `HighlightStyle` from it; the preview derives a `tagHighlighter` from it and applies it in a hydration pass modelled on the existing chart hydrator. No new runtime dependency — the grammars are the editor's own, loaded lazily by `@codemirror/language-data`.

**Tech Stack:** Svelte 5 (runes), TypeScript, CodeMirror 6, Lezer, Vitest 4, jsdom 30.

## Source design

`docs/superpowers/specs/2026-08-09-code-colour-design.md` (commit `c6b275d`). Read it first — its "What is actually there today" section corrects two wrong readings of this code and is the reason the work is additive.

## Global Constraints

- Branch `feat/code-colour`, already checked out and holding the spec commit.
- **Unmapped tags stay plain.** Registering any non-fallback highlighter displaces CodeMirror's `defaultHighlightStyle` entirely (`getHighlighters` returns `main.length ? main : fallback`), and `hermesHighlight` already does. So nothing falls back to CodeMirror's colours, and a tag left out of the table is simply uncoloured — as all code is today.
- `frontend/public/style.css` is governed by two tests: `styleContract.test.ts` (no literal colours in rules; the `:root`, `:root[data-theme="dark"]` and `@media print` blocks must declare **identical** names) and `contrast.test.ts` (each pair in `PAIRS` meets its target in the light and dark blocks; print is not checked).
- Palette values, all three blocks — light / dark / print:
  `--syn-keyword` `#7b2d8e` / `#d6a3e8` / `#7b2d8e`;
  `--syn-string` `#1a6b3a` / `#8fd19e` / `#1a6b3a`;
  `--syn-number` `#9a4a00` / `#e0a878` / `#9a4a00`;
  `--syn-type` `#0d6b6b` / `#7fd0d0` / `#0d6b6b`;
  `--syn-function` `#1a4fa0` / `#8fb8f0` / `#1a4fa0`.
- Comments reuse the existing `--syn-meta`. No sixth name.
- **Do not add a runtime dependency.** `@lezer/highlight`, `@codemirror/language` and `@codemirror/language-data` are already direct dependencies.
- **Do not import a concrete grammar package transitively.** If a test needs one, declare it in `devDependencies`. Importing `@codemirror/commands` transitively broke seven unrelated tests earlier in this project.
- Style idiom: no semicolons, single quotes, 2-space indent, comments explaining *why*.
- Tests: `(cd frontend && npx vitest run)`; type check `(cd frontend && npm run check)`; Go `go test ./.` (single dot).

---

### Task 1: The palette tokens

**Files:**
- Modify: `frontend/public/style.css` — three palette blocks
- Test: `frontend/src/lib/contrast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: five `--syn-*` names available to Tasks 2 and 3. Nothing references them yet; `styleContract.test.ts` checks that referenced variables are defined, not the reverse.

- [ ] **Step 1: Write the failing test**

In `frontend/src/lib/contrast.test.ts`, add five entries to `PAIRS`, after the existing `--syn-meta` line. The editor background is the right comparison — this is code in a code block, not body text:

```ts
  ['syntax keyword', '--syn-keyword', '--editor-bg', 4.5],
  ['syntax string', '--syn-string', '--editor-bg', 4.5],
  ['syntax number', '--syn-number', '--editor-bg', 4.5],
  ['syntax type', '--syn-type', '--editor-bg', 4.5],
  ['syntax function', '--syn-function', '--editor-bg', 4.5],
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd frontend && npx vitest run src/lib/contrast.test.ts)`
Expected: FAIL in both the light and dark cases. `palette()` has no entry, so `relativeLuminance` receives `undefined` and throws `TypeError: Cannot read properties of undefined (reading 'replace')`. That is the expected RED; note which mode you saw.

- [ ] **Step 3: Add the tokens**

In `frontend/public/style.css`, in the light `:root` block, after `--syn-meta: #6b6b6b;`:

```css
  /* Code tokens. Applied by one table (lib/syntaxTags.ts) to both the editor's
     HighlightStyle and the preview's hydrator, so the two panes cannot drift.
     Comments deliberately reuse --syn-meta above: a comment is metadata. */
  --syn-keyword: #7b2d8e;
  --syn-string: #1a6b3a;
  --syn-number: #9a4a00;
  --syn-type: #0d6b6b;
  --syn-function: #1a4fa0;
```

In `:root[data-theme="dark"]`, after its `--syn-meta`:

```css
  --syn-keyword: #d6a3e8;
  --syn-string: #8fd19e;
  --syn-number: #e0a878;
  --syn-type: #7fd0d0;
  --syn-function: #8fb8f0;
```

In the `@media print` block's `:root, :root[data-theme="dark"]`, after its `--syn-meta` (four-space indent there, not two):

```css
    /* The light values: exported PDFs are always light, these are already dark
       enough for paper, and contrast.test.ts does not check the print block —
       a separate set would be five more numbers nothing verifies. */
    --syn-keyword: #7b2d8e;
    --syn-string: #1a6b3a;
    --syn-number: #9a4a00;
    --syn-type: #0d6b6b;
    --syn-function: #1a4fa0;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run src/lib/contrast.test.ts src/lib/styleContract.test.ts)`
Expected: PASS. Lowest ratio is `--syn-string` at 6.38:1 light. The three-block parity check still passes because all five went into all three.

- [ ] **Step 5: Commit**

```bash
git add frontend/public/style.css frontend/src/lib/contrast.test.ts
git commit -m "feat: add palette colours for code tokens"
```

---

### Task 2: The shared tag table, and the editor

**Files:**
- Create: `frontend/src/lib/syntaxTags.ts`
- Create: `frontend/src/lib/syntaxTags.test.ts`
- Modify: `frontend/src/Editor.svelte` — `hermesHighlight`

**Interfaces:**
- Consumes: the palette names from Task 1.
- Produces:
  - `interface TokenRole { name: string; tags: Tag[] }`
  - `const CODE_TOKENS: TokenRole[]` — the mapping.
  - `function codeHighlightStyleSpecs(): { tag: Tag; color: string }[]` — the editor derivation.
  - `function codeTagHighlighter(): Highlighter` — the preview derivation, used by Task 3.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/syntaxTags.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tags } from '@lezer/highlight'
import { CODE_TOKENS, codeHighlightStyleSpecs, codeTagHighlighter } from './syntaxTags'

describe('CODE_TOKENS', () => {
  it('names only palette roles that exist in the stylesheet', () => {
    // Guards the half of the contract CSS cannot: a role here with no
    // --syn-<name> in the palette silently produces an unstyled token.
    expect(CODE_TOKENS.map((r) => r.name).sort()).toEqual([
      'comment',
      'function',
      'keyword',
      'number',
      'string',
      'type',
    ])
  })

  it('resolves every tag it names', () => {
    // A misremembered tag is not a wrong colour, it is `undefined` reaching
    // HighlightStyle.define — so this fails loudly rather than losing a colour.
    for (const role of CODE_TOKENS) {
      for (const tag of role.tags) {
        expect(tag, `a tag in role "${role.name}" did not resolve`).toBeDefined()
      }
    }
  })

  it('maps each tag exactly once', () => {
    // Two roles claiming one tag is a colour decided by array order.
    const all = CODE_TOKENS.flatMap((r) => r.tags)
    expect(new Set(all).size).toBe(all.length)
  })

  it('points every role at a palette variable that exists', () => {
    // `comment` is the one role whose class and colour differ: it takes the
    // markdown `meta` colour. Deriving `var(--syn-comment)` would reference a
    // variable no palette block defines, and nothing in CSS would catch it,
    // because the name is built in TypeScript.
    const defined = ['keyword', 'string', 'number', 'type', 'function', 'meta']
    for (const role of CODE_TOKENS) {
      expect(defined, `role "${role.name}"`).toContain(role.palette ?? role.name)
    }
  })

  it('does not claim markdown\'s own meta tag', () => {
    // Editor.svelte maps tags.meta for frontmatter and markdown punctuation;
    // claiming it here would give one tag two rules.
    const all = new Set(CODE_TOKENS.flatMap((r) => r.tags))
    expect(all.has(tags.meta)).toBe(false)
  })
})

describe('derivations', () => {
  it('gives the editor one spec per tag, coloured from the palette', () => {
    const specs = codeHighlightStyleSpecs()
    expect(specs.length).toBe(CODE_TOKENS.flatMap((r) => r.tags).length)
    for (const s of specs) expect(s.color).toMatch(/^var\(--syn-[a-z]+\)$/)
  })

  it('gives the preview a highlighter', () => {
    expect(typeof codeTagHighlighter().style).toBe('function')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd frontend && npx vitest run src/lib/syntaxTags.test.ts)`
Expected: FAIL — `Failed to resolve import "./syntaxTags"`.

- [ ] **Step 3: Write the module**

Create `frontend/src/lib/syntaxTags.ts`:

```ts
import { tagHighlighter, tags, type Highlighter, type Tag } from '@lezer/highlight'

/** A palette role and the Lezer tags that take its colour. */
export interface TokenRole {
  /** The `.tok-<name>` class the preview emits. */
  name: string
  /**
   * The `--syn-<palette>` variable that colours it, when it differs from
   * `name`. Comments are the case: they take the markdown `meta` colour
   * rather than owning one, because a comment is metadata.
   */
  palette?: string
  tags: Tag[]
}

/**
 * How code tokens are coloured, for every language at once.
 *
 * Lezer grammars all tag from one shared vocabulary, so this is per token
 * type rather than per language: `def` in Python and `func` in Go both carry
 * `tags.keyword`. Adding a language needs no entry here.
 *
 * Both panes derive from this list and nothing else, which is what stops the
 * editor and the preview drifting apart.
 *
 * Anything absent stays uncoloured. That is safe rather than broken:
 * `hermesHighlight` is a non-fallback highlighter, so CodeMirror's
 * `defaultHighlightStyle` is displaced entirely and there is nothing to fall
 * back to. Adding a role later is this list plus a palette entry.
 *
 * Comments are here too, with `palette: 'meta'` — they need a class for the
 * preview, but take the markdown `meta` colour rather than a sixth of their
 * own. Keeping them in this table is what stops the two panes disagreeing
 * about the one token type markdown also has an opinion on.
 */
export const CODE_TOKENS: TokenRole[] = [
  {
    name: 'keyword',
    tags: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.self,
      tags.null,
      tags.bool,
      tags.atom,
    ],
  },
  {
    name: 'string',
    tags: [tags.string, tags.special(tags.string), tags.regexp, tags.character],
  },
  { name: 'number', tags: [tags.number, tags.integer, tags.float, tags.literal] },
  { name: 'type', tags: [tags.typeName, tags.className, tags.namespace] },
  {
    name: 'function',
    tags: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.variableName),
    ],
  },
  {
    name: 'comment',
    palette: 'meta',
    tags: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
  },
]

/**
 * The editor's half: one HighlightStyle spec per tag, coloured through the
 * palette so a theme change needs no reconfiguration.
 */
export function codeHighlightStyleSpecs(): { tag: Tag; color: string }[] {
  return CODE_TOKENS.flatMap((role) =>
    role.tags.map((tag) => ({ tag, color: `var(--syn-${role.palette ?? role.name})` })),
  )
}

/**
 * The preview's half: the same table as classes, since a hydrated span cannot
 * carry a CodeMirror style. `style.css` maps each `.tok-<name>` to the same
 * `--syn-<name>` the editor uses.
 */
export function codeTagHighlighter(): Highlighter {
  return tagHighlighter(CODE_TOKENS.map((role) => ({ tag: role.tags, class: `tok-${role.name}` })))
}
```

- [ ] **Step 4: Wire the editor**

In `frontend/src/Editor.svelte`, add to the imports:

```ts
  import { codeHighlightStyleSpecs } from './lib/syntaxTags'
```

and extend `hermesHighlight` — the markdown rules stay exactly as they are, with the code specs spread in after them:

```ts
  const hermesHighlight = HighlightStyle.define([
    { tag: tags.heading, color: 'var(--syn-heading)', fontWeight: 'bold' },
    { tag: tags.emphasis, color: 'var(--syn-emphasis)', fontStyle: 'italic' },
    { tag: tags.strong, color: 'var(--syn-emphasis)', fontWeight: 'bold' },
    { tag: tags.monospace, color: 'var(--syn-code)' },
    { tag: tags.link, color: 'var(--syn-link)' },
    { tag: tags.url, color: 'var(--syn-link)' },
    { tag: tags.quote, color: 'var(--syn-quote)' },
    { tag: tags.meta, color: 'var(--syn-meta)' },
    // Code tokens, from the table both panes share. Comments arrive through
    // it too, carrying the --syn-meta colour above.
    ...codeHighlightStyleSpecs(),
  ])
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run && npm run check)`
Expected: PASS across the whole suite. `Editor.test.ts`'s theme test asserts the editor's generated CSS uses only `var(--…)` and no literal colours — the new specs must not break it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/syntaxTags.ts frontend/src/lib/syntaxTags.test.ts frontend/src/Editor.svelte
git commit -m "feat: colour code tokens in the editor from a shared table"
```

---

### Task 3: The preview hydrator

**Files:**
- Create: `frontend/src/lib/codeHighlight.ts`
- Create: `frontend/src/lib/codeHighlight.test.ts`
- Modify: `frontend/src/Preview.svelte`
- Modify: `frontend/public/style.css` — the `.tok-*` rules

**Interfaces:**
- Consumes: `codeTagHighlighter` from Task 2, the palette from Task 1.
- Produces: `createCodeHydrator(load?: LoadGrammar): CodeHydrator`, mirroring `createChartHydrator(embed?)`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/codeHighlight.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { markdown } from '@codemirror/lang-markdown'
import type { Parser } from '@lezer/common'
import { createCodeHydrator, type LoadGrammar } from './codeHighlight'

/**
 * A real parser, from the one grammar package this project depends on
 * directly. Reaching for `@codemirror/lang-python` through language-data
 * would be a transitive import — the thing that broke seven tests when it was
 * done with @codemirror/commands.
 */
const markdownParser: Parser = markdown().language.parser

function containerWith(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

const block = (lang: string, code: string) =>
  `<pre><code data-source-line="1" class="language-${lang}">${code}</code></pre>`

describe('createCodeHydrator', () => {
  it('replaces a code block\'s text with tagged spans', async () => {
    const load: LoadGrammar = vi.fn(async () => markdownParser)
    const c = containerWith(block('markdown', '# Heading'))

    await createCodeHydrator(load).hydrate(c)

    const code = c.querySelector('code')!
    expect(code.querySelectorAll('span').length).toBeGreaterThan(0)
    // The text must survive exactly — highlighting is presentation only.
    expect(code.textContent).toBe('# Heading')
  })

  it('keeps the source-line anchor on the code element', async () => {
    // Only the children are replaced. Scroll sync reads every
    // [data-source-line]; losing or duplicating one desynchronises the pane.
    const c = containerWith(block('markdown', '# Heading'))
    await createCodeHydrator(async () => markdownParser).hydrate(c)

    expect(c.querySelectorAll('[data-source-line]').length).toBe(1)
    expect(c.querySelector('code')!.dataset.sourceLine).toBe('1')
  })

  it('leaves a block alone when the language is unknown', async () => {
    const load: LoadGrammar = vi.fn(async () => null)
    const c = containerWith(block('notalang', 'some text'))

    await createCodeHydrator(load).hydrate(c)

    expect(c.querySelector('code')!.querySelectorAll('span').length).toBe(0)
    expect(c.querySelector('code')!.textContent).toBe('some text')
  })

  it('leaves a block alone when the grammar fails to load', async () => {
    const load: LoadGrammar = vi.fn(async () => {
      throw new Error('network')
    })
    const c = containerWith(block('markdown', '# Heading'))

    await expect(createCodeHydrator(load).hydrate(c)).resolves.toBeUndefined()
    expect(c.querySelector('code')!.textContent).toBe('# Heading')
  })

  it('skips a fence with no language', async () => {
    const load: LoadGrammar = vi.fn(async () => markdownParser)
    const c = containerWith('<pre><code>plain</code></pre>')

    await createCodeHydrator(load).hydrate(c)

    expect(load).not.toHaveBeenCalled()
  })

  it('parses identical content once, however many passes', async () => {
    // Preview assigns innerHTML on every debounced keystroke, so without a
    // cache a large document re-parses every block as you type.
    const load = vi.fn(async () => markdownParser)
    const h = createCodeHydrator(load as LoadGrammar)

    await h.hydrate(containerWith(block('markdown', '# Heading')))
    await h.hydrate(containerWith(block('markdown', '# Heading')))

    expect(load).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd frontend && npx vitest run src/lib/codeHighlight.test.ts)`
Expected: FAIL — `Failed to resolve import "./codeHighlight"`.

- [ ] **Step 3: Write the hydrator**

Create `frontend/src/lib/codeHighlight.ts`:

```ts
import { highlightCode } from '@lezer/highlight'
import { languages } from '@codemirror/language-data'
import type { Parser } from '@lezer/common'
import { codeTagHighlighter } from './syntaxTags'

/** Resolves a fence's language name to a parser, or null if unknown. */
export type LoadGrammar = (name: string) => Promise<Parser | null>

export interface CodeHydrator {
  hydrate(container: HTMLElement): Promise<void>
}

/**
 * The default resolver: the editor's own grammars, looked up by name or alias
 * and imported on demand. A paper with one Python block loads one grammar; a
 * paper with none loads nothing — the same laziness charts.ts applies to
 * vega-embed, for the same reason.
 */
export async function loadGrammar(name: string): Promise<Parser | null> {
  const lower = name.toLowerCase()
  const desc = languages.find(
    (l) => l.name.toLowerCase() === lower || l.alias.includes(lower),
  )
  if (!desc) return null
  const support = await desc.load()
  return support.language.parser
}

const HIGHLIGHTER = codeTagHighlighter()

/**
 * Turns `<pre><code class="language-x">` blocks into tagged spans.
 *
 * A hydration pass rather than part of render(): markdown-it's `highlight`
 * option is synchronous and grammars load asynchronously, and render() runs on
 * every debounced keystroke so it has to stay cheap. Modelled on
 * createChartHydrator, including the generation guard.
 *
 * Unlike that one it does not invalidate scroll-sync anchors afterwards —
 * spans do not change a block's height.
 */
export function createCodeHydrator(load: LoadGrammar = loadGrammar): CodeHydrator {
  // Keyed on language and source text, which is all the output depends on.
  // Preview.svelte reassigns innerHTML on every render, so without this a
  // large document re-parses every block on every keystroke.
  const cache = new Map<string, DocumentFragment>()
  let generation = 0

  return {
    async hydrate(container: HTMLElement): Promise<void> {
      const gen = ++generation
      const blocks = Array.from(
        container.querySelectorAll<HTMLElement>('pre > code[class*="language-"]'),
      )

      for (const el of blocks) {
        const lang = /language-([^\s]+)/.exec(el.className)?.[1]
        if (!lang) continue
        const code = el.textContent ?? ''
        const key = `${lang} ${code}`

        const cached = cache.get(key)
        if (cached) {
          el.replaceChildren(cached.cloneNode(true))
          continue
        }

        let parser: Parser | null = null
        try {
          parser = await load(lang)
        } catch {
          // An unavailable grammar leaves the block exactly as it renders
          // today. Every failure here degrades to plain text on purpose.
          continue
        }
        if (gen !== generation) return // a newer pass owns the DOM now
        if (!parser) continue

        const fragment = document.createDocumentFragment()
        highlightCode(
          code,
          parser.parse(code),
          HIGHLIGHTER,
          (text, classes) => {
            // Real nodes rather than an HTML string: the text is document
            // content, and building nodes sidesteps escaping entirely.
            if (!classes) return void fragment.append(text)
            const span = document.createElement('span')
            span.className = classes
            span.textContent = text
            fragment.append(span)
          },
          () => fragment.append('\n'),
        )
        cache.set(key, fragment)
        el.replaceChildren(fragment.cloneNode(true))
      }
    },
  }
}
```

- [ ] **Step 4: Add the classes to the stylesheet**

In `frontend/public/style.css`, after the `.preview-pane :not(pre) > code` rule:

```css
/* Code tokens in the preview. The class names come from lib/syntaxTags.ts and
   the colours from the same palette variables the editor's HighlightStyle
   uses, so a block looks identical in both panes and follows the theme. */
.preview-pane .tok-keyword { color: var(--syn-keyword); }
.preview-pane .tok-string { color: var(--syn-string); }
.preview-pane .tok-number { color: var(--syn-number); }
.preview-pane .tok-type { color: var(--syn-type); }
.preview-pane .tok-function { color: var(--syn-function); }
.preview-pane .tok-comment { color: var(--syn-meta); }
```

`.tok-comment` resolves to `--syn-meta` rather than a `--syn-comment` that does not exist, because its role carries `palette: 'meta'`. That is the one place a class name and a palette name differ, and Task 2's test pins it.

- [ ] **Step 5: Wire it into Preview.svelte**

Add the import beside the chart hydrator:

```ts
  import { createCodeHydrator } from './lib/codeHighlight'
```

Create it beside the other:

```ts
  const hydrator = createChartHydrator()
  const codeHydrator = createCodeHydrator()
```

And in the render effect, run it alongside — deliberately not chained to the chart hydrator's `sync.invalidate()`, because highlighting changes no heights:

```svelte
  $effect(() => {
    container.innerHTML = html
    sync.invalidate()
    void hydrator.hydrate(container).then(() => sync.invalidate())
    void codeHydrator.hydrate(container)
  })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run && npm run check)`
Expected: PASS across the whole suite, including `Preview.test.ts` and `styleContract.test.ts` — the new rules use only `var(--…)`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/codeHighlight.ts frontend/src/lib/codeHighlight.test.ts frontend/src/Preview.svelte frontend/public/style.css
git commit -m "feat: highlight code in the preview from the same table"
```

---

### Task 4: Documentation and verification

**Files:**
- Modify: `CHANGELOG.md`, `ROADMAP.md`, `docs/test-document.md`

- [ ] **Step 1: Run the full verification suite**

```bash
go test ./. && go build -o /dev/null . && (cd frontend && npx vitest run && npm run check)
```

Expected: all green. `go build` emits pre-existing macOS linker warnings on this machine; any other noise is a finding. Do not proceed on a failure.

- [ ] **Step 2: Correct the roadmap's false claim**

`ROADMAP.md`'s v0.7 syntax-highlighting bullet says *"Half of this already exists… the editor already highlights nested languages: a ` ```python ` block is already coloured while you type."* That is wrong — the editor tags the tokens but colours none of them, because a non-fallback highlighter displaces CodeMirror's default. Mark both this bullet and v0.8's document-source colour bullet `- [x]`, and replace the false sentence with what was actually the case:

> The editor loaded the grammars and tagged the tokens, but coloured none of
> them: registering any non-fallback highlighter displaces CodeMirror's
> `defaultHighlightStyle` entirely, and `hermesHighlight` mapped only the six
> markdown tags. Both panes showed monochrome code, so the work was additive
> in both.

- [ ] **Step 3: Write the changelog entry**

Under `## [Unreleased]` → `### Added`:

```markdown
- Code blocks are syntax highlighted, in the editor and the preview, from one
  shared table — so a block looks the same while you write it and after it
  renders, and the same again in an exported PDF. Around 150 languages are
  recognised, each grammar loaded only if a document uses it. Colouring is by
  token type rather than by language, so a new language needs no new colours,
  and a fence with an unknown language stays plain rather than erroring.
```

- [ ] **Step 4: Update the test document**

`docs/test-document.md` section 4 says preview colours "are not expected yet — that is v0.7" and that the editor already colours the block. Both are now wrong. Replace that paragraph with a check that the two panes agree, that the theme switch carries both, and that an unknown language stays plain.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md ROADMAP.md docs/test-document.md
git commit -m "docs: record code highlighting and correct the roadmap's claim"
```

- [ ] **Step 6: Hand over the manual check**

Reproduce in the report as NOT DONE, for a human:

1. Open `docs/test-document.md`. Section 4's Python block is coloured in both panes, and the two match.
2. Switch View → Appearance between Light and Dark. Both panes follow.
3. Type in the document: code does not flicker — the cache is working.
4. Add a fence in a language used nowhere else; it colours after a brief pause as the grammar loads once.
5. ` ```notalang ` stays plain rather than erroring.
6. ⌘E: code is coloured in the PDF and legible on white.

---

## Self-Review

**Spec coverage.** The mapping table, the five palette names and their print values → Tasks 1 and 2. The editor derivation → Task 2. The hydration pass, its cache, its generation guard, DOM nodes over HTML strings, and the anchor surviving → Task 3. The error-handling table → Task 3's tests, one case each. The roadmap correction the spec calls for → Task 4.

**Placeholder scan.** Every code step carries the code; every test step the assertions.

**Type consistency.** `LoadGrammar`, `CodeHydrator`, `createCodeHydrator`, `TokenRole`, `CODE_TOKENS`, `codeHighlightStyleSpecs` and `codeTagHighlighter` are defined in Tasks 2 and 3 and used with those exact names.

**One thing a reviewer should watch.** `comment` is the only role whose class name and palette name differ (`.tok-comment` coloured by `--syn-meta`), via the optional `palette` field. A derivation that ignored that field would emit `var(--syn-comment)`, which no palette block defines — and nothing in CSS would catch it, since the name is assembled in TypeScript. Task 2 has a test for exactly this; check it survives, and check both derivations honour the field rather than only the editor one.
