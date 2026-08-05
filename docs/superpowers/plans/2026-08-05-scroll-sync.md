# Scroll Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As the editor scrolls, the preview follows — optional, off by default, toggled from a new View menu and persisted.

**Architecture:** A markdown-it core rule stamps `data-source-line` on every top-level block. A pure mapper interpolates a source line to a preview scroll offset between the two anchors bracketing it, so blocks whose rendered height diverges wildly from their source (charts, tables, math) are handled exactly rather than approximately. All the logic lives in `lib/scrollSync.ts`; the components are thin glue.

**Tech Stack:** Svelte 5 (runes, `mount`/`flushSync`), TypeScript, markdown-it, CodeMirror 6, Vitest, jsdom, Go 1.25 + Wails v3.

**Spec:** [docs/superpowers/specs/2026-08-05-scroll-sync-design.md](../specs/2026-08-05-scroll-sync-design.md)

## Global Constraints

- Frontend work is in `frontend/`; `settings.go`, `menu.go`, `CHANGELOG.md` and `ROADMAP.md` are at the repo ROOT. **Use an explicit `cd` in every bash call** — the working directory does not reliably persist between calls.
- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`). No Svelte 4 store syntax.
- Verification: `npx vitest run`, `npm run check` (must report `0 ERRORS`), `npm run build` — all from `frontend/`. Go: `go test ./.` and `go build -o /dev/null .` from the repo root (note `./.`, not `./...`).
- Baseline before starting: **144 frontend tests across 11 files**, Go tests passing.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Component tests: call `flushSync()` after `mount()` before asserting.** Svelte 5 runs `onMount` in a microtask; without it the DOM is still empty and you get a confusing `expected null not to be null`.
- **jsdom has no layout engine.** `getBoundingClientRect()`, `offsetTop`, `scrollHeight` and `clientHeight` all return **0**. Verified during planning. Never write a test that asserts a measured pixel value. `scrollTop` is the exception — jsdom stores and returns whatever you assign, so it *is* assertable.
- If a service method's Go doc comment changes, regenerate bindings with `wails3 task common:generate:bindings` from the repo root.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/scrollSync.ts` (create) | The mapper, the DOM anchor reader, and the caching controller. All sync logic. |
| `src/lib/scrollSync.test.ts` (create) | Mapper and controller, both headless. |
| `src/lib/frontmatter.ts` (modify) | Report which document line the body starts on. |
| `src/lib/renderer.ts` (modify) | Core rule stamping `data-source-line`; chart placeholders carry it too. |
| `src/lib/charts.ts` (modify) | Refresh a reused cached chart's source line. |
| `src/Editor.svelte` (modify) | Report top visible line and line count; emit a scroll event. |
| `src/Preview.svelte` (modify) | Own the sync controller; expose `syncToLine`. |
| `src/Preview.test.ts` (create) | Sync applied with injected anchors. |
| `src/App.svelte` (modify) | Read the setting, guard, coalesce, wire the two panes. |
| `settings.go`, `menu.go` (modify) | `SyncScrolling` preference and the View menu. |

---

## Task 1: The pure mapper

**Files:**
- Create: `frontend/src/lib/scrollSync.ts`
- Test: `frontend/src/lib/scrollSync.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Anchor { line: number; top: number }` and
  `previewOffsetForLine(anchors: Anchor[], line: number, docLines: number, scrollHeight: number): number`.
  Task 4 calls this; Tasks 5-7 depend on the `Anchor` shape.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/scrollSync.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { previewOffsetForLine, type Anchor } from './scrollSync'

// line 10 → 500px, line 20 → 1500px. 10 source lines spanning 1000 rendered px.
const ANCHORS: Anchor[] = [
  { line: 10, top: 500 },
  { line: 20, top: 1500 },
]
const DOC_LINES = 40
const SCROLL_HEIGHT = 4000

describe('previewOffsetForLine', () => {
  it('returns an anchor exactly when the line lands on one', () => {
    expect(previewOffsetForLine(ANCHORS, 10, DOC_LINES, SCROLL_HEIGHT)).toBe(500)
    expect(previewOffsetForLine(ANCHORS, 20, DOC_LINES, SCROLL_HEIGHT)).toBe(1500)
  })

  it('interpolates between two anchors', () => {
    // halfway between line 10 and line 20 → halfway between 500 and 1500
    expect(previewOffsetForLine(ANCHORS, 15, DOC_LINES, SCROLL_HEIGHT)).toBe(1000)
  })

  it('interpolates from a virtual (line 1, y 0) before the first anchor', () => {
    // frontmatter and anything above the first block still scrolls smoothly
    // rather than pinning to the top. Line 1 → 0; line 10 → 500; so line 5.5
    // would be 250. Use line 4: (4-1)/(10-1) = 1/3 of 500.
    expect(previewOffsetForLine(ANCHORS, 4, DOC_LINES, SCROLL_HEIGHT)).toBeCloseTo(166.67, 1)
  })

  it('interpolates toward a virtual (docLines, scrollHeight) after the last anchor', () => {
    // line 20 → 1500, line 40 → 4000. Line 30 is halfway: 2750.
    expect(previewOffsetForLine(ANCHORS, 30, DOC_LINES, SCROLL_HEIGHT)).toBe(2750)
  })

  it('returns 0 when there are no anchors', () => {
    expect(previewOffsetForLine([], 12, DOC_LINES, SCROLL_HEIGHT)).toBe(0)
  })

  it('maps proportionally within a block that renders far taller than its source', () => {
    // The case the whole design exists for: a Vega chart occupying 3 source
    // lines and 2000 rendered pixels. Scrolling one line into it must advance
    // the preview a third of the way through the chart, not skip it.
    const chart: Anchor[] = [
      { line: 10, top: 500 },
      { line: 13, top: 2500 },
    ]
    expect(previewOffsetForLine(chart, 11, DOC_LINES, SCROLL_HEIGHT)).toBeCloseTo(1166.67, 1)
    expect(previewOffsetForLine(chart, 12, DOC_LINES, SCROLL_HEIGHT)).toBeCloseTo(1833.33, 1)
  })

  it('clamps into [0, scrollHeight]', () => {
    expect(previewOffsetForLine(ANCHORS, -5, DOC_LINES, SCROLL_HEIGHT)).toBe(0)
    expect(previewOffsetForLine(ANCHORS, 9999, DOC_LINES, SCROLL_HEIGHT)).toBe(SCROLL_HEIGHT)
  })

  it('does not divide by zero in a single-line document', () => {
    expect(previewOffsetForLine([{ line: 1, top: 0 }], 1, 1, 0)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/scrollSync.test.ts`
Expected: FAIL — cannot resolve `./scrollSync`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/scrollSync.ts`:

```ts
export interface Anchor {
  /** 1-based line in the source document where this block starts. */
  line: number
  /** Pixels from the top of the preview's scroll content. */
  top: number
}

function clamp(y: number, scrollHeight: number): number {
  return Math.max(0, Math.min(y, scrollHeight))
}

/**
 * Maps a source line to a preview scroll offset by interpolating between the
 * two anchors bracketing it.
 *
 * Interpolating *between* known-correct points is what makes divergent block
 * heights a non-problem: a chart occupying three source lines and 2000
 * rendered pixels is simply a long interval, with no error term to accumulate
 * down the rest of the document.
 *
 * Both ends use virtual anchors so the document's edges stay reachable:
 * `(line 1, y 0)` before the first real anchor — so frontmatter scrolls
 * smoothly instead of pinning to the top — and `(docLines, scrollHeight)`
 * after the last, so the end of the document is reachable rather than
 * clamping at the final block.
 *
 * `anchors` must be sorted ascending by line.
 */
export function previewOffsetForLine(
  anchors: Anchor[],
  line: number,
  docLines: number,
  scrollHeight: number,
): number {
  if (anchors.length === 0) return 0

  let beforeLine = 1
  let beforeTop = 0
  let afterLine = Math.max(docLines, 1)
  let afterTop = scrollHeight

  for (const anchor of anchors) {
    if (anchor.line === line) return clamp(anchor.top, scrollHeight)
    if (anchor.line < line) {
      beforeLine = anchor.line
      beforeTop = anchor.top
    } else {
      afterLine = anchor.line
      afterTop = anchor.top
      break
    }
  }

  const span = afterLine - beforeLine
  if (span <= 0) return clamp(beforeTop, scrollHeight)
  const ratio = (line - beforeLine) / span
  return clamp(beforeTop + ratio * (afterTop - beforeTop), scrollHeight)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/scrollSync.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/richarc/Development/hermes/frontend
git add src/lib/scrollSync.ts src/lib/scrollSync.test.ts
git commit -m "$(cat <<'EOF'
feat: add the source-line to preview-offset mapper

Interpolates between the two anchors bracketing a source line, with virtual
anchors at both document edges. Interpolating between known-correct points
is what makes a block whose rendered height diverges from its source — a
chart, a table — exact rather than approximate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Emit `data-source-line` anchors

**Files:**
- Modify: `frontend/src/lib/frontmatter.ts`
- Modify: `frontend/src/lib/renderer.ts:12-23`
- Test: `frontend/src/lib/frontmatter.test.ts`, `frontend/src/lib/renderer.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: rendered HTML in which top-level blocks carry `data-source-line="<1-based document line>"`. Task 4's `collectAnchors` reads exactly this attribute. Also produces `Frontmatter.bodyStartLine: number`.

**Why frontmatter matters here.** `render()` strips the frontmatter block and passes only the body to markdown-it, so markdown-it's line numbers are **body-relative** while the editor's are **document-absolute**. Without correcting for this every anchor in a document with frontmatter is short by the length of that block — and every Hermes document that uses citations has frontmatter. The offset is passed through markdown-it's `env`.

- [ ] **Step 1: Write the failing frontmatter test**

Append to `frontend/src/lib/frontmatter.test.ts`:

```ts
describe('bodyStartLine', () => {
  it('is 1 when there is no frontmatter', () => {
    expect(parseFrontmatter('# Title\n').bodyStartLine).toBe(1)
  })

  it('is the first line after the closing fence', () => {
    // ---(1) bibliography(2) ---(3) → body starts on line 4
    expect(parseFrontmatter('---\nbibliography: r.bib\n---\n# Title\n').bodyStartLine).toBe(4)
  })

  it('counts a multi-line block', () => {
    const src = '---\na: 1\nb: 2\nc: 3\n---\nbody\n'
    expect(parseFrontmatter(src).bodyStartLine).toBe(6)
  })

  it('is 1 for an unterminated block, which is not frontmatter', () => {
    expect(parseFrontmatter('---\nnot closed\n# Title\n').bodyStartLine).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/frontmatter.test.ts`
Expected: FAIL — `bodyStartLine` is `undefined`.

- [ ] **Step 3: Implement `bodyStartLine`**

In `frontend/src/lib/frontmatter.ts`, add the field to the interface:

```ts
export interface Frontmatter {
  body: string
  bibliography?: string
  csl?: string
  /**
   * 1-based line of the original document on which `body` starts. The renderer
   * passes markdown-it only the body, so its line numbers are body-relative;
   * scroll-sync anchors must be document-absolute to line up with the editor.
   */
  bodyStartLine: number
}
```

In `parseFrontmatter`, the no-match early return becomes:

```ts
  if (!match) return { body: markdown, bodyStartLine: 1 }
```

and the result initialiser becomes:

```ts
  const result: Frontmatter = {
    body: markdown.slice(match[0].length),
    // match[0] ends with the newline after the closing fence, so the number of
    // complete lines it consumes is its newline count.
    bodyStartLine: match[0].split('\n').length,
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/frontmatter.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing renderer test**

Append to `frontend/src/lib/renderer.test.ts`:

```ts
describe('render: source-line anchors', () => {
  it('stamps every top-level block with its 1-based source line', () => {
    const html = render('# Title\n\nPara.\n\n| a |\n|---|\n| 1 |\n')
    expect(html).toContain('<h1 data-source-line="1"')
    expect(html).toContain('<p data-source-line="3"')
    expect(html).toContain('<table data-source-line="5"')
  })

  it('stamps vega-lite chart placeholders, which build their own HTML', () => {
    const html = render('Intro.\n\n```vega-lite\n{"mark":"bar"}\n```\n')
    expect(html).toContain('class="vega-lite-chart"')
    expect(html).toMatch(/<div class="vega-lite-chart" data-source-line="3"/)
  })

  it('offsets anchors past the frontmatter, so they match editor lines', () => {
    // ---(1) csl(2) ---(3) blank(4) # Title(5)
    const html = render('---\ncsl: apa\n---\n\n# Title\n')
    expect(html).toContain('<h1 data-source-line="5"')
  })

  it('keeps anchors out of inline content', () => {
    const html = render('Some *emphasis* here.\n')
    expect(html).toContain('<p data-source-line="1"')
    expect(html).not.toContain('<em data-source-line')
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/renderer.test.ts`
Expected: FAIL — no `data-source-line` attributes are emitted.

- [ ] **Step 7: Implement the core rule and the chart anchor**

In `frontend/src/lib/renderer.ts`, add the core rule immediately after
`const md = new MarkdownIt(...)` and its `md.use(katexPlugin, ...)` line:

```ts
// Stamp every top-level block with the document line it starts on, for scroll
// sync to anchor against. Only level-0 tokens carry a `map`; inline tokens do
// not, which is what keeps this off spans and emphasis.
//
// `env.sourceLineOffset` corrects for the frontmatter that render() strips
// before markdown-it ever sees the text — without it every anchor in a
// document with frontmatter is short by that block's length.
md.core.ruler.push('source_line', (state) => {
  const offset = (state.env as { sourceLineOffset?: number }).sourceLineOffset ?? 0
  for (const token of state.tokens) {
    if (token.level === 0 && token.map) {
      token.attrSet('data-source-line', String(token.map[0] + 1 + offset))
    }
  }
  return true
})
```

Replace the `vega-lite` branch of the fence override so it carries the anchor:

```ts
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim() === 'vega-lite') {
    // This branch builds its own HTML and never calls renderAttrs, so the
    // anchor the core rule set on the token has to be written out by hand.
    // Charts are the largest source of height divergence — the very reason
    // anchors beat a scroll ratio — so losing theirs would gut the feature.
    const line = token.attrGet('data-source-line') ?? ''
    return `<div class="vega-lite-chart" data-source-line="${md.utils.escapeHtml(line)}" data-spec="${md.utils.escapeHtml(token.content.trim())}"></div>\n`
  }
  return defaultFence(tokens, idx, options, env, self)
}
```

In `render()`, pass the offset through `env`. The function currently starts:

```ts
export function render(markdown: string, opts?: RenderOptions): string {
  const { body } = parseFrontmatter(markdown)
  const env: { citations?: CitationCluster[] } = {}
```

Change those two lines to:

```ts
export function render(markdown: string, opts?: RenderOptions): string {
  const { body, bodyStartLine } = parseFrontmatter(markdown)
  const env: { citations?: CitationCluster[]; sourceLineOffset: number } = {
    sourceLineOffset: bodyStartLine - 1,
  }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run`
Expected: PASS, 160 tests across 12 files.

- [ ] **Step 9: Typecheck and commit**

```bash
cd /Users/richarc/Development/hermes/frontend && npm run check
git add src/lib/frontmatter.ts src/lib/frontmatter.test.ts src/lib/renderer.ts src/lib/renderer.test.ts
git commit -m "$(cat <<'EOF'
feat: stamp rendered blocks with their source line

A markdown-it core rule adds data-source-line to every top-level block, for
scroll sync to anchor against. Only level-0 tokens carry a map, which keeps
the attribute off inline spans.

Two things the naive version gets wrong. render() strips frontmatter before
markdown-it sees the text, so line numbers are body-relative while the
editor's are document-absolute — parseFrontmatter now reports bodyStartLine
and the offset rides through env. And the vega-lite fence override builds
its own HTML without calling renderAttrs, so charts would have silently had
no anchor at all despite being the main reason anchors beat a scroll ratio.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Keep cached chart anchors fresh

**Files:**
- Modify: `frontend/src/lib/charts.ts` (the cached-reuse branch inside `hydrate`)
- Test: `frontend/src/lib/charts.test.ts`

**Interfaces:**
- Consumes: the `data-source-line` attribute from Task 2.
- Produces: nothing new; a correctness guarantee Task 5 relies on.

**The bug being prevented.** `hydrate` caches a rendered chart keyed by its spec text and calls `el.replaceWith(cached)` on later passes. The cached node keeps the `data-source-line` it was born with, so inserting a paragraph *above* a chart moves the chart in the source but not in its anchor — and scroll sync silently desynchronises from that point down while everything still looks fine.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/charts.test.ts`:

```ts
describe('cached charts keep their source line fresh', () => {
  it('adopts the new placeholder line when a cached node is reused', async () => {
    const h = createChartHydrator(fakeEmbed)

    const first = containerWith(
      `<div class="vega-lite-chart" data-source-line="5" data-spec="${SPEC}"></div>`,
    )
    await h.hydrate(first)

    // The user inserted text above the chart: same spec, later line.
    const second = containerWith(
      `<div class="vega-lite-chart" data-source-line="30" data-spec="${SPEC}"></div>`,
    )
    await h.hydrate(second)

    const chart = second.querySelector<HTMLElement>('.vega-lite-chart')
    expect(chart).not.toBeNull()
    expect(chart!.dataset.sourceLine).toBe('30')
  })
})
```

Note: `containerWith`, `SPEC`, and the fake embed already exist at the top of `charts.test.ts` — reuse them rather than redefining. The existing fake embed is passed to `createChartHydrator`; check its local name and use it (the file defines it via `vi.mock('vega-embed', ...)` plus a locally-constructed `EmbedFn` in the hydrator tests).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/charts.test.ts`
Expected: FAIL — `dataset.sourceLine` is `'5'`, the line the cached node was born with.

- [ ] **Step 3: Implement**

In `frontend/src/lib/charts.ts`, in `hydrate`'s cached-reuse branch:

```ts
        if (cached && !placedThisPass.has(cached)) {
          // The cached node still carries the source line it was rendered at.
          // Editing above the chart moves it, so adopt the fresh placeholder's
          // line — otherwise scroll sync desynchronises from here down while
          // the chart itself still looks perfectly correct.
          if (el.dataset.sourceLine !== undefined) {
            cached.dataset.sourceLine = el.dataset.sourceLine
          }
          el.replaceWith(cached)
          placedThisPass.add(cached)
          continue
        }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/charts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/richarc/Development/hermes/frontend
git add src/lib/charts.ts src/lib/charts.test.ts
git commit -m "$(cat <<'EOF'
fix: refresh a reused cached chart's source line

The hydrator caches a rendered chart by spec text and moves that node into
each new render. It kept the data-source-line it was born with, so editing
above a chart would move it in the source but not in its anchor, silently
desynchronising scroll sync from that point down while the chart still
rendered correctly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The anchor reader and the caching controller

**Files:**
- Modify: `frontend/src/lib/scrollSync.ts`
- Test: `frontend/src/lib/scrollSync.test.ts`

**Interfaces:**
- Consumes: `previewOffsetForLine` and `Anchor` from Task 1; the `data-source-line` attribute from Task 2.
- Produces:
  - `collectAnchors(container: HTMLElement): Anchor[]`
  - `interface ScrollSyncTarget { getAnchors(): Anchor[]; getScrollHeight(): number; setScrollTop(y: number): void }`
  - `createScrollSync(target: ScrollSyncTarget): { sync(line: number, docLines: number): void; invalidate(): void }`

  Task 5's `Preview.svelte` builds a target from real DOM accessors.

**A note on what is and is not tested here.** `collectAnchors` reads `getBoundingClientRect`, which returns 0 for everything in jsdom — so it has **no automated test**, deliberately. That is exactly why it is a separate three-line function: all the behaviour worth testing lives in `createScrollSync` and `previewOffsetForLine`, which are driven through fakes. Do not write a `collectAnchors` test that asserts zeros and calls it coverage.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/scrollSync.test.ts`:

```ts
import { createScrollSync, type ScrollSyncTarget } from './scrollSync'

function fakeTarget(anchors: Anchor[], scrollHeight = 4000) {
  const calls: number[] = []
  let measured = 0
  const target: ScrollSyncTarget = {
    getAnchors: () => {
      measured++
      return anchors
    },
    getScrollHeight: () => scrollHeight,
    setScrollTop: (y) => calls.push(y),
  }
  return { target, calls, measurements: () => measured }
}

describe('createScrollSync', () => {
  it('scrolls the target to the mapped offset', () => {
    const { target, calls } = fakeTarget(ANCHORS)
    createScrollSync(target).sync(15, DOC_LINES)
    expect(calls).toEqual([1000])
  })

  it('measures anchors once and reuses them across syncs', () => {
    const { target, measurements } = fakeTarget(ANCHORS)
    const sync = createScrollSync(target)
    sync.sync(12, DOC_LINES)
    sync.sync(14, DOC_LINES)
    sync.sync(16, DOC_LINES)
    expect(measurements()).toBe(1)
  })

  it('re-measures after invalidate', () => {
    const { target, measurements } = fakeTarget(ANCHORS)
    const sync = createScrollSync(target)
    sync.sync(12, DOC_LINES)
    sync.invalidate()
    sync.sync(12, DOC_LINES)
    expect(measurements()).toBe(2)
  })

  it('does not scroll when the document has no anchors', () => {
    const { target, calls } = fakeTarget([])
    createScrollSync(target).sync(12, DOC_LINES)
    expect(calls).toEqual([])
  })

  it('re-measures on the next sync, not eagerly on invalidate', () => {
    const { target, measurements } = fakeTarget(ANCHORS)
    const sync = createScrollSync(target)
    sync.sync(12, DOC_LINES)
    sync.invalidate()
    expect(measurements()).toBe(1) // nothing measured yet
    sync.sync(12, DOC_LINES)
    expect(measurements()).toBe(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/scrollSync.test.ts`
Expected: FAIL — `createScrollSync` is not exported.

- [ ] **Step 3: Implement**

Append to `frontend/src/lib/scrollSync.ts`:

```ts
/**
 * Reads anchors out of rendered preview content.
 *
 * Measured with `getBoundingClientRect` deltas rather than `offsetTop`, so the
 * result does not depend on any ancestor being positioned.
 *
 * Untested by design: jsdom has no layout engine and reports every rectangle
 * as zero. Keeping this to three lines is what makes that acceptable — the
 * logic worth testing lives in createScrollSync and previewOffsetForLine.
 */
export function collectAnchors(container: HTMLElement): Anchor[] {
  const containerTop = container.getBoundingClientRect().top
  const anchors: Anchor[] = []
  for (const el of container.querySelectorAll<HTMLElement>('[data-source-line]')) {
    const line = Number(el.dataset.sourceLine)
    if (!Number.isFinite(line) || line < 1) continue
    anchors.push({
      line,
      top: el.getBoundingClientRect().top - containerTop + container.scrollTop,
    })
  }
  return anchors.sort((a, b) => a.line - b.line)
}

export interface ScrollSyncTarget {
  getAnchors(): Anchor[]
  getScrollHeight(): number
  setScrollTop(y: number): void
}

/**
 * Holds measured anchors between syncs, since measuring forces layout and a
 * scroll produces a burst of events. The cache is invalidated by the caller on
 * re-render, on chart hydration completing, and on resize; it is rebuilt
 * lazily on the next sync that needs it rather than eagerly on invalidation.
 */
export function createScrollSync(target: ScrollSyncTarget) {
  let anchors: Anchor[] | null = null
  return {
    invalidate(): void {
      anchors = null
    },
    sync(line: number, docLines: number): void {
      anchors ??= target.getAnchors()
      if (anchors.length === 0) return
      target.setScrollTop(
        previewOffsetForLine(anchors, line, docLines, target.getScrollHeight()),
      )
    },
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/scrollSync.test.ts`
Expected: PASS, 13 tests in this file.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check
git add src/lib/scrollSync.ts src/lib/scrollSync.test.ts
git commit -m "$(cat <<'EOF'
feat: add the anchor reader and the sync controller

collectAnchors measures with getBoundingClientRect deltas rather than
offsetTop, so it does not depend on an ancestor being positioned. It has no
automated test on purpose: jsdom reports every rectangle as zero, so a test
would assert zeros and prove nothing. Keeping it to three lines is what
makes that acceptable — the caching and mapping behaviour is driven through
fakes instead.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected suite state: 166 tests across 12 files.

---

## Task 5: Pane plumbing

**Files:**
- Modify: `frontend/src/Editor.svelte`
- Modify: `frontend/src/Preview.svelte`
- Test: `frontend/src/Preview.test.ts` (create), `frontend/src/Editor.test.ts`

**Interfaces:**
- Consumes: `collectAnchors`, `createScrollSync`, `Anchor` from Task 4.
- Produces:
  - `Editor.topVisibleLine(): number` and `Editor.lineCount(): number`, plus an `onscroll?: () => void` prop.
  - `Preview.syncToLine(line: number, docLines: number): void`, plus an injectable `collectAnchorsFn?: (c: HTMLElement) => Anchor[]` prop defaulting to the real `collectAnchors`.

  Task 7 calls all of these.

**On the injectable prop.** `Preview` takes its anchor reader as a prop so tests can supply known anchors and assert a real scroll offset — jsdom would otherwise measure zeros. This mirrors `createChartHydrator(embed: EmbedFn = embedChart)`, the same seam `charts.ts` already uses for the same reason.

- [ ] **Step 1: Write the failing Preview test**

Create `frontend/src/Preview.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import Preview from './Preview.svelte'
import type { Anchor } from './lib/scrollSync'

vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: vi.fn() } }))

const ANCHORS: Anchor[] = [
  { line: 10, top: 500 },
  { line: 20, top: 1500 },
]

interface PreviewApi {
  syncToLine(line: number, docLines: number): void
}

function mountPreview(html: string, anchors: Anchor[] = ANCHORS) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(Preview, {
    target,
    props: { html, collectAnchorsFn: () => anchors },
  }) as unknown as PreviewApi
  flushSync()
  const pane = target.querySelector('.preview-pane') as HTMLElement
  // jsdom reports scrollHeight as 0, so stub the one measurement the mapper
  // needs. scrollTop itself is stored and returned faithfully by jsdom.
  Object.defineProperty(pane, 'scrollHeight', { value: 4000, configurable: true })
  return { target, pane, preview: cmp, cleanup: () => unmount(cmp as never) }
}

describe('Preview.syncToLine', () => {
  it('scrolls to the interpolated offset for a line', () => {
    const { pane, preview, cleanup } = mountPreview('<p data-source-line="10">x</p>')
    preview.syncToLine(15, 40)
    expect(pane.scrollTop).toBe(1000)
    cleanup()
  })

  it('lands exactly on an anchor when the line matches one', () => {
    const { pane, preview, cleanup } = mountPreview('<p data-source-line="10">x</p>')
    preview.syncToLine(20, 40)
    expect(pane.scrollTop).toBe(1500)
    cleanup()
  })

  it('does not scroll when the document has no anchors', () => {
    const { pane, preview, cleanup } = mountPreview('<p>x</p>', [])
    preview.syncToLine(15, 40)
    expect(pane.scrollTop).toBe(0)
    cleanup()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/Preview.test.ts`
Expected: FAIL — `syncToLine` is not a function.

- [ ] **Step 3: Implement `Preview.svelte`**

Replace the script block of `frontend/src/Preview.svelte` with:

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Browser } from '@wailsio/runtime'
  import { createChartHydrator } from './lib/charts'
  import { collectAnchors, createScrollSync, type Anchor } from './lib/scrollSync'

  let {
    html,
    // Injectable so tests can supply known anchors: jsdom has no layout engine
    // and would measure every element at zero. Mirrors createChartHydrator's
    // embed parameter, which exists for the same reason.
    collectAnchorsFn = collectAnchors,
  }: { html: string; collectAnchorsFn?: (c: HTMLElement) => Anchor[] } = $props()

  let container: HTMLElement
  const hydrator = createChartHydrator()

  const sync = createScrollSync({
    getAnchors: () => collectAnchorsFn(container),
    getScrollHeight: () => container.scrollHeight,
    setScrollTop: (y) => (container.scrollTop = y),
  })

  export function syncToLine(line: number, docLines: number): void {
    sync.sync(line, docLines)
  }

  $effect(() => {
    container.innerHTML = html
    // Anchor positions are invalid the moment the content changes, and again
    // once charts finish rendering — they change their own height after the
    // pass that created them.
    sync.invalidate()
    void hydrator.hydrate(container).then(() => sync.invalidate())
  })

  onMount(() => {
    const onResize = () => sync.invalidate()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  })

  onDestroy(() => hydrator.destroy())

  function onPreviewClick(e: MouseEvent) {
    const anchor = (e.target as Element).closest('a')
    if (!anchor) return
    e.preventDefault()
    const href = anchor.getAttribute('href')
    if (href && /^https?:\/\//i.test(href)) {
      void Browser.OpenURL(href)
    }
  }
</script>
```

Leave the markup below the script block unchanged.

- [ ] **Step 4: Run the Preview test to verify it passes**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/Preview.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing Editor test**

Append to `frontend/src/Editor.test.ts`:

```ts
describe('Editor scroll reporting', () => {
  it('reports the document line count', () => {
    const { editor, cleanup } = mountEditor()
    editor.setContent('a\nb\nc\nd\n')
    flushSync()
    expect(editor.lineCount()).toBe(5) // four lines plus the trailing empty one
    cleanup()
  })

  it('calls onscroll when the editor scroller scrolls', () => {
    const scrolls: number[] = []
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(Editor, {
      target,
      props: { onchange: () => {}, onscroll: () => scrolls.push(1) },
    }) as unknown as { setContent(t: string): void }
    flushSync()

    const scroller = target.querySelector('.cm-scroller') as HTMLElement
    scroller.dispatchEvent(new Event('scroll'))
    expect(scrolls.length).toBe(1)

    unmount(cmp as never)
  })
})
```

The existing `mountEditor` helper at the top of this file returns
`{ target, editor, text, cleanup }`; extend its `EditorApi` interface with
`lineCount(): number` and `topVisibleLine(): number` so the first test
typechecks.

- [ ] **Step 6: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/Editor.test.ts`
Expected: FAIL — `lineCount` is not a function.

- [ ] **Step 7: Implement `Editor.svelte`**

Extend the props destructuring:

```ts
  let {
    onchange,
    onformat,
    onscroll,
  }: {
    onchange: (text: string) => void
    onformat?: (name: string) => void
    onscroll?: () => void
  } = $props()
```

Add two exported functions next to the existing ones:

```ts
  /** Total lines in the document, for mapping against the preview's extent. */
  export function lineCount(): number {
    return view.state.doc.lines
  }

  /**
   * The 1-based line at the top of the visible editor area.
   *
   * Resolved through posAtCoords at the scroller's top-left corner rather than
   * arithmetic on scrollTop, which keeps everything in one coordinate space
   * instead of reconciling documentTop against documentPadding. A null result
   * means the point is outside the content — treat that as the top.
   */
  export function topVisibleLine(): number {
    const rect = view.scrollDOM.getBoundingClientRect()
    const pos = view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 })
    if (pos == null) return 1
    return view.state.doc.lineAt(pos).number
  }
```

In `onMount`, after the view is constructed, attach the scroll listener and
extend the returned cleanup:

```ts
    const onScrollDOM = () => onscroll?.()
    view.scrollDOM.addEventListener('scroll', onScrollDOM, { passive: true })
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScrollDOM)
      view.destroy()
    }
```

The listener goes on `view.scrollDOM` directly, not through
`EditorView.domEventHandlers` — scroll events do not bubble, so a handler on
the editor element would never see the scroller's.

- [ ] **Step 8: Run everything and commit**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check
git add src/Editor.svelte src/Editor.test.ts src/Preview.svelte src/Preview.test.ts
git commit -m "$(cat <<'EOF'
feat: add scroll reporting to the editor and sync to the preview

Editor reports its top visible line via posAtCoords — one coordinate space
rather than reconciling documentTop against documentPadding — and emits a
scroll event from view.scrollDOM directly, since scroll does not bubble.

Preview owns the sync controller and invalidates its anchor cache on
re-render, on chart hydration finishing, and on resize. Its anchor reader is
an injectable prop so tests can assert a real offset; jsdom has no layout
engine and would measure everything at zero.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected suite state: 171 tests across 13 files.

---

## Task 6: The `SyncScrolling` preference and the View menu

**Files:**
- Modify: `settings.go` (repo root)
- Modify: `menu.go` (repo root)
- Test: `settings_test.go` (repo root)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Settings.SyncScrolling bool` with json tag `syncScrolling`, reachable from the frontend as `(await DocumentService.Settings()).syncScrolling`. Task 7 reads it.

- [ ] **Step 1: Write the failing test**

Append to `settings_test.go`:

```go
func TestSyncScrollingDefaultsToOff(t *testing.T) {
	s := newTestService(t)
	if s.Settings().SyncScrolling {
		t.Error("want sync scrolling off by default")
	}
}

func TestSyncScrollingPersists(t *testing.T) {
	recentsPath := filepath.Join(t.TempDir(), "recents.json")
	s := NewDocumentService(recentsPath)

	next := s.Settings()
	next.SyncScrolling = true
	if err := s.UpdateSettings(next); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if !NewDocumentService(recentsPath).Settings().SyncScrolling {
		t.Error("want sync scrolling persisted across instances")
	}
}

func TestSyncScrollingIsIndependentOfOrientation(t *testing.T) {
	// The two settings share one struct and one file; changing either must not
	// disturb the other.
	s := newTestService(t)
	if err := s.UpdateSettings(Settings{PrintOrientation: "landscape", SyncScrolling: true}); err != nil {
		t.Fatal(err)
	}
	got := s.Settings()
	if got.PrintOrientation != "landscape" || !got.SyncScrolling {
		t.Errorf("got %+v", got)
	}

	next := got
	next.SyncScrolling = false
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	if s.Settings().PrintOrientation != "landscape" {
		t.Error("toggling sync scrolling disturbed the orientation")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes && go test ./. -run TestSyncScrolling`
Expected: FAIL to compile — `SyncScrolling` is not a field of `Settings`.

- [ ] **Step 3: Add the field**

In `settings.go`, extend the struct and the defaults:

```go
type Settings struct {
	PrintOrientation string `json:"printOrientation"`
	SyncScrolling    bool   `json:"syncScrolling"`
}

func defaultSettings() Settings {
	return Settings{PrintOrientation: "portrait", SyncScrolling: false}
}
```

In `normalise`, add a comment above the existing orientation clause so the
absence of a bool clause does not read as an oversight:

```go
func (s Settings) normalise() Settings {
	// SyncScrolling needs no clause: every value a bool can hold is valid.
	// Only fields with a restricted set of legal values are clamped here.
	if s.PrintOrientation != "portrait" && s.PrintOrientation != "landscape" {
		s.PrintOrientation = defaultSettings().PrintOrientation
	}
	return s
}
```

- [ ] **Step 4: Run the Go tests**

Run: `cd /Users/richarc/Development/hermes && go test ./.`
Expected: PASS.

- [ ] **Step 5: Add the View menu**

In `menu.go`, between the Format submenu block and `menu.AddRole(application.WindowMenu)`:

```go
	view := menu.AddSubmenu("View")
	// No accelerator: the obvious chords are taken, and this is not a frequent
	// action — the same reasoning as Blockquote in the Format menu.
	view.AddCheckbox("Sync Scrolling", current.SyncScrolling).OnClick(func(*application.Context) {
		next := docs.Settings()
		next.SyncScrolling = !next.SyncScrolling
		if err := docs.UpdateSettings(next); err != nil {
			log.Printf("could not save sync scrolling: %v", err)
		}
	})
```

`current` is already in scope — it is the `docs.Settings()` value the PDF
Orientation radio items read. Changing the setting fires the existing
`settings:changed` path, which rebuilds the menu, so the checkbox state stays
correct without extra wiring.

- [ ] **Step 6: Verify the whole Go side**

Run:
```bash
cd /Users/richarc/Development/hermes && gofmt -l . | grep -v '^build/' ; go vet ./. && go test ./. && go build -o /dev/null .
```
Expected: no gofmt output, vet clean, tests pass, build succeeds.

- [ ] **Step 7: Regenerate bindings and commit**

The `Settings` model gained a field, so the generated TypeScript must be updated:

```bash
cd /Users/richarc/Development/hermes && wails3 task common:generate:bindings
cd frontend && npm run check
```
Expected: `frontend/bindings/hermes/models.ts` gains `syncScrolling: boolean`; `0 ERRORS`.

```bash
cd /Users/richarc/Development/hermes
git add settings.go settings_test.go menu.go frontend/bindings
git commit -m "$(cat <<'EOF'
feat: add the SyncScrolling preference and a View menu

A checkbox item in a new View menu, persisted alongside the PDF orientation
in the same Settings value. The bool needs no normalise clause — every value
it can hold is valid — which the code now says explicitly so its absence is
not mistaken for an oversight.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire the panes together

**Files:**
- Modify: `frontend/src/App.svelte`
- Test: `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `Editor.topVisibleLine()`, `Editor.lineCount()`, the `onscroll` prop, and `Preview.syncToLine()` from Task 5; `Settings.syncScrolling` from Task 6.
- Produces: the finished feature.

**What these tests can and cannot prove.** The spec asks for a component test
showing that "scrolling the editor with sync on moves the preview". At App
level that is **not achievable in jsdom**: `topVisibleLine()` depends on
`posAtCoords`, which needs layout and returns null here, so it always reports
line 1 — and line 1 maps to offset 0 whether sync is on or off. The positive
case is therefore covered one level down, in `Preview.test.ts` (Task 5), where
anchors are injected and a real offset is asserted. At App level we cover the
guard (sync off does not move the preview) and the settings wiring. The
end-to-end behaviour is confirmed by the manual check at the end of this plan.
Do not try to force a positive App-level assertion — it can only pass by
accident.


- [ ] **Step 1: Write the failing test**

Append to `frontend/src/App.test.ts`. The `vi.hoisted` harness at the top of
that file already mocks the bindings — extend its `DocumentService` object with
a `Settings` mock, and add a hoisted `settings` holder beside the existing
`recents` one:

```ts
// In the existing vi.hoisted block, add alongside `recents`:
//   const settings = { current: { printOrientation: 'portrait', syncScrolling: false } }
// and inside DocumentService:
//   Settings: vi.fn(async () => settings.current),
//   UpdateSettings: vi.fn(async () => {}),

describe('scroll sync', () => {
  it('does not move the preview while sync is off', async () => {
    settings.current = { printOrientation: 'portrait', syncScrolling: false }
    recents.current = []
    const { target } = mountApp()
    await vi.waitFor(() => expect(target.querySelector('.cm-scroller')).not.toBeNull())

    const pane = target.querySelector('.preview-pane') as HTMLElement
    Object.defineProperty(pane, 'scrollHeight', { value: 4000, configurable: true })
    const scroller = target.querySelector('.cm-scroller') as HTMLElement
    scroller.dispatchEvent(new Event('scroll'))
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    expect(pane.scrollTop).toBe(0)
  })

  it('reads the persisted setting at startup', async () => {
    settings.current = { printOrientation: 'portrait', syncScrolling: true }
    recents.current = []
    mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())
  })

  it('re-reads the setting when the menu changes it', async () => {
    settings.current = { printOrientation: 'portrait', syncScrolling: false }
    recents.current = []
    mountApp()
    await vi.waitFor(() => expect(DocumentService.Settings).toHaveBeenCalled())

    const before = DocumentService.Settings.mock.calls.length
    settings.current = { printOrientation: 'portrait', syncScrolling: true }
    listeners['settings:changed']({ data: null })
    await vi.waitFor(() =>
      expect(DocumentService.Settings.mock.calls.length).toBeGreaterThan(before),
    )
  })
})
```

Note the `afterEach` added in the earlier fix wave unmounts for you — do not
call `cleanup()` by hand.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/App.test.ts`
Expected: FAIL — `DocumentService.Settings` is never called; the app reads no settings today.

- [ ] **Step 3: Implement**

In `frontend/src/App.svelte`, add to the imports:

```ts
  import type { Settings } from '../bindings/hermes/models'
```

Add state beside the other `$state` declarations:

```ts
  let preview: ReturnType<typeof Preview>
  let syncScrolling = $state(false)
  let scrollFrame: number | null = null
```

Add the settings reader and the scroll handler beside the other functions:

```ts
  async function refreshSettings() {
    const s: Settings = await DocumentService.Settings()
    syncScrolling = s.syncScrolling
  }

  // Scroll fires in bursts; one measurement per frame is plenty, and coalescing
  // keeps a fast scroll from forcing layout dozens of times.
  function onEditorScroll() {
    if (!syncScrolling || scrollFrame !== null) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null
      if (!syncScrolling) return
      preview.syncToLine(editor.topVisibleLine(), editor.lineCount())
    })
  }
```

In `onMount`, add the event subscription beside the others and the initial read
inside the existing async IIFE:

```ts
    Events.On('settings:changed', () => void refreshSettings())
```

and, in the IIFE that already awaits `refreshRecents()`:

```ts
    void (async () => {
      await Promise.all([refreshRecents(), refreshSettings()])
      if (recents.length === 0) doNew()
    })()
```

Update the two component usages in the markup:

```svelte
      <Editor bind:this={editor} onchange={onEditorChange} onformat={applyFormat} onscroll={onEditorScroll} />
```

```svelte
    <Preview bind:this={preview} {html} />
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/App.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check && npm run build
cd /Users/richarc/Development/hermes && go test ./. && go build -o /dev/null .
```
Expected: 174 tests across 13 files; `0 ERRORS`; both builds succeed.

- [ ] **Step 6: Commit**

```bash
cd /Users/richarc/Development/hermes
git add frontend/src/App.svelte frontend/src/App.test.ts
git commit -m "$(cat <<'EOF'
feat: wire scroll sync between the panes

App reads the persisted setting at startup and again on settings:changed —
the first time the frontend has consumed app settings at all — guards on it,
and coalesces the editor's scroll burst into one measurement per frame.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Record the shipped work

**Files:**
- Modify: `CHANGELOG.md`, `ROADMAP.md` (repo root)

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` → `### Added`:

```markdown
- Optional scroll sync: with View → Sync Scrolling enabled, the preview
  follows the editor as it scrolls. Off by default and remembered between
  sessions. Rendered position is derived by interpolating between the source
  lines of the surrounding blocks, so a chart or table that occupies a few
  lines of markdown and a great deal of rendered height stays aligned instead
  of drifting the rest of the document out of step.
```

- [ ] **Step 2: Tick the roadmap item**

In `ROADMAP.md`, change the v0.4.0 item beginning "Optional scroll sync
between the editor and preview panes" from `- [ ]` to `- [x]`.

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check
cd /Users/richarc/Development/hermes && go test ./.
git add CHANGELOG.md ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: record scroll sync in the changelog and roadmap

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification summary

| After task | Frontend tests | Files |
|---|---|---|
| Baseline | 144 | 11 |
| 1 | 152 | 12 |
| 2 | 160 | 12 |
| 3 | 161 | 12 |
| 4 | 166 | 12 |
| 5 | 171 | 13 |
| 6 | 171 (Go +3) | 13 |
| 7 | 174 | 13 |

If a count comes out lower than expected, a test was skipped rather than the
arithmetic being wrong — check before continuing.

## Manual check, once, at the end

The pixel behaviour cannot be tested in jsdom. After Task 7, run the app and
confirm by eye that the preview tracks the editor, and specifically that it
stays aligned across a Vega chart — the case the whole design exists for.

```bash
cd /Users/richarc/Development/hermes && wails3 task run
```

Open `docs/sample-paper.md`, enable View → Sync Scrolling, and scroll through
the chart.
