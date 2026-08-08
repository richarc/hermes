# Figure Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Hermes captioned, automatically numbered, consistently placed and sized figures — charts and images — driven by each format's native caption home.

**Architecture:** A new pure module `frontend/src/lib/figures.ts` holds the caption/width/alignment vocabulary and a markdown-it core rule that walks top-level tokens, counts captioned figures in document order and stamps each one. `renderer.ts` consumes it: the `vega-lite` fence renderer lifts the spec's `title` out into a `<figcaption>`, injects a `width`, and moves the scroll-sync anchor onto the wrapping `<figure>`; image paragraphs are turned into `<figure>` tokens by the rule itself. Two new `Settings` fields (`figureAlignment`, `chartWidth`) reach the frontend through the existing settings pipeline — width through `render()`, alignment through a `data-figure-align` attribute on the preview root.

**Tech Stack:** Go 1.26 + Wails v3 (alpha), Svelte 5 (runes), TypeScript, Vite, markdown-it 14, Vitest 4, vega-lite 6.

## Source design

`docs/superpowers/specs/2026-08-08-chart-presentation-design.md`. Read it before starting; it explains *why* each decision below is what it is.

### One deliberate deviation from that design

The design says alignment is applied as `text-align` on `.preview-pane figure`, `.preview-pane .vega-lite-chart` **and `.preview-pane img`**. The third selector does nothing: `text-align` positions a block's *inline children*, and an `<img>` is itself an inline child — the property has to sit on the containing block. `figure` and `.vega-lite-chart` are blocks and work as designed; a bare uncaptioned image sits inside markdown-it's `<p>`, which is what needs the rule.

This plan therefore uses `p:has(> img:only-child)` for that third case, which centres a lone image without centring ordinary prose (WebKit has supported `:has()` since Safari 15.4 / macOS 12.3). Everything else in the design is implemented exactly as written. If the `:has()` floor is unacceptable, the fallback is to drop uncaptioned-image alignment entirely — do not substitute `display: block; margin-inline: auto` on `img`, which would break images used inline in a sentence.

## Global Constraints

- Go module is `hermes`; run Go checks as `go test ./. && go build -o /dev/null .` (`.`, not `./...`).
- Never hand-edit `frontend/bindings/**` — regenerate with `wails3 task common:generate:bindings`.
- Frontend tests: `(cd frontend && npx vitest run)`; a single file: `(cd frontend && npx vitest run src/lib/figures.test.ts)`.
- Type check: `(cd frontend && npm run check)`.
- No literal colours in `style.css` rules — only `var(--name)` from the palette at the top of the file. `src/lib/styleContract.test.ts` fails the build otherwise, and the light and dark `:root` blocks *and* the `@media print` block must all declare the same variable names.
- Hermes spells its own identifiers **`centre`**; CSS spells it **`center`**. Map at the boundary. `centre` must never appear in a CSS rule.
- The caption label is exactly `Figure N — ` : the word in full, the number, a space, U+2014 EM DASH, a space, then the author's text. Written into the HTML as real text, never a CSS counter.
- Chart width values: `small` → 240, `medium` → 400, `large` → 560 (Vega-Lite `width`, i.e. the plotting area only).
- Defaults: `figureAlignment` = `centre`, `chartWidth` = `medium`.
- A block without a caption must render exactly as it does today, except for the injected `width`.
- Release target: v0.6.0.
- `vega-embed` is imported dynamically in `lib/charts.ts` and must stay that way.

---

### Task 1: The figures vocabulary (pure helpers)

**Files:**
- Create: `frontend/src/lib/figures.ts`
- Create: `frontend/src/lib/figures.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ChartWidth = 'small' | 'medium' | 'large'`
  - `type FigureAlignment = 'left' | 'centre' | 'right'`
  - `const CHART_WIDTH_PX: Record<ChartWidth, number>`
  - `function chartWidthPx(name: string | undefined): number`
  - `function captionFromTitle(title: unknown): string`
  - `function chartCaption(specText: string): string`
  - `function figureLabel(n: number, caption: string): string`
  - `function cssTextAlign(alignment: string | undefined): 'left' | 'center' | 'right'`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/figures.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  CHART_WIDTH_PX,
  captionFromTitle,
  chartCaption,
  chartWidthPx,
  cssTextAlign,
  figureLabel,
} from './figures'

describe('captionFromTitle: the three shapes Vega-Lite allows', () => {
  it('takes a plain string title', () => {
    expect(captionFromTitle('Recovered sources')).toBe('Recovered sources')
  })

  it('takes the text of an object title', () => {
    expect(captionFromTitle({ text: 'Recovered sources' })).toBe('Recovered sources')
  })

  it('joins a multi-line object title with a space', () => {
    expect(captionFromTitle({ text: ['line one', 'line two'] })).toBe('line one line two')
  })

  it('trims surrounding whitespace', () => {
    expect(captionFromTitle('  padded  ')).toBe('padded')
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['a number', 42],
    ['an object with no text', { anchor: 'start' }],
    ['an object with a non-string text', { text: 42 }],
    ['an array of non-strings', { text: [1, 2] }],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('returns no caption for %s', (_name, value) => {
    expect(captionFromTitle(value)).toBe('')
  })
})

describe('chartCaption', () => {
  it('reads the title out of spec text', () => {
    expect(chartCaption('{"title":"Sources","mark":"bar"}')).toBe('Sources')
  })

  it('returns no caption for unparseable JSON', () => {
    expect(chartCaption('not json')).toBe('')
  })

  it('returns no caption for a spec that is not an object', () => {
    expect(chartCaption('[1, 2]')).toBe('')
    expect(chartCaption('null')).toBe('')
  })
})

describe('figureLabel', () => {
  it('reads "Figure N — caption", with an em dash', () => {
    expect(figureLabel(2, 'Recovered sources')).toBe('Figure 2 — Recovered sources')
  })
})

describe('chartWidthPx', () => {
  it('maps each named width to its pixel value', () => {
    expect(chartWidthPx('small')).toBe(240)
    expect(chartWidthPx('medium')).toBe(400)
    expect(chartWidthPx('large')).toBe(560)
  })

  it('falls back to medium for an unknown or missing name', () => {
    expect(chartWidthPx(undefined)).toBe(CHART_WIDTH_PX.medium)
    expect(chartWidthPx('enormous')).toBe(CHART_WIDTH_PX.medium)
  })
})

describe('cssTextAlign', () => {
  it('maps Hermes spelling to the CSS keyword', () => {
    // The one mapping that cannot be checked by reading the CSS: `centre` is
    // Hermes' identifier, `center` is the only spelling CSS understands.
    expect(cssTextAlign('centre')).toBe('center')
  })

  it('passes left and right through unchanged', () => {
    expect(cssTextAlign('left')).toBe('left')
    expect(cssTextAlign('right')).toBe('right')
  })

  it('falls back to centre for an unknown or missing value', () => {
    expect(cssTextAlign(undefined)).toBe('center')
    expect(cssTextAlign('justified')).toBe('center')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd frontend && npx vitest run src/lib/figures.test.ts)`
Expected: FAIL — `Failed to resolve import "./figures"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/figures.ts`:

```ts
/**
 * Figure presentation: what makes a block a figure, what its caption reads,
 * and the two document-wide settings that place and size it.
 *
 * A caption is what makes a figure. Without one a chart or image renders
 * exactly as it did before this module existed, which is what keeps existing
 * documents untouched until their author adds a caption.
 */

export type ChartWidth = 'small' | 'medium' | 'large'
export type FigureAlignment = 'left' | 'centre' | 'right'

/**
 * These are Vega-Lite's `width`, which sizes the PLOTTING AREA and excludes
 * axes, tick labels and the legend — a chart at 400 occupies noticeably more
 * than 400px in total. Worth remembering before tuning them against a page.
 */
export const CHART_WIDTH_PX: Record<ChartWidth, number> = {
  small: 240,
  medium: 400,
  large: 560,
}

export const DEFAULT_CHART_WIDTH: ChartWidth = 'medium'

/** Pixels for a named width; anything unrecognised falls back to the default. */
export function chartWidthPx(name: string | undefined): number {
  return CHART_WIDTH_PX[name as ChartWidth] ?? CHART_WIDTH_PX[DEFAULT_CHART_WIDTH]
}

/**
 * The caption a Vega-Lite `title` carries, or '' if it carries none.
 *
 * Vega-Lite allows three shapes and all three are accepted: a bare string, an
 * object with a string `text`, and an object whose `text` is an array of
 * lines (joined with a space). Anything else — a number, a styling-only
 * object, `null` — is not a caption, so the block is not a figure.
 */
export function captionFromTitle(title: unknown): string {
  if (typeof title === 'string') return title.trim()
  if (typeof title === 'object' && title !== null && !Array.isArray(title)) {
    const text = (title as { text?: unknown }).text
    if (typeof text === 'string') return text.trim()
    if (Array.isArray(text) && text.every((t) => typeof t === 'string')) {
      return text.join(' ').trim()
    }
  }
  return ''
}

/** The caption a `vega-lite` block's spec text carries, or '' for none. */
export function chartCaption(specText: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(specText)
  } catch {
    // Unparseable JSON is not a figure. The existing error card in charts.ts
    // still reports the chart itself, so nothing is lost by declining here.
    return ''
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return ''
  return captionFromTitle((parsed as Record<string, unknown>).title)
}

/**
 * "Figure 2 — Recovered sources".
 *
 * Written into the HTML as real text rather than produced by a CSS counter,
 * so it survives copy-paste and PDF text extraction.
 */
export function figureLabel(n: number, caption: string): string {
  return `Figure ${n} — ${caption}`
}

/**
 * Hermes spells its own identifiers `centre`; CSS only understands `center`.
 * The mapping happens here, at the boundary, exactly as it already does for
 * colour/color — so no stylesheet rule ever carries the British spelling.
 */
export function cssTextAlign(alignment: string | undefined): 'left' | 'center' | 'right' {
  if (alignment === 'left') return 'left'
  if (alignment === 'right') return 'right'
  return 'center'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `(cd frontend && npx vitest run src/lib/figures.test.ts)`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/figures.ts frontend/src/lib/figures.test.ts
git commit -m "feat: add the figure caption, width and alignment vocabulary"
```

---

### Task 2: Inject a chart width at render time

**Files:**
- Modify: `frontend/src/lib/renderer.ts:36-48` (the fence renderer), `:67-76` (`RenderOptions` and `render`)
- Test: `frontend/src/lib/renderer.test.ts` (append a new describe block after the `render: vega-lite fences` block, around line 72)

**Interfaces:**
- Consumes: `chartWidthPx`, `type ChartWidth` from Task 1's `./figures`.
- Produces: `RenderOptions` gains `chartWidth?: ChartWidth`. `render(markdown, { chartWidth })` writes a `width` into every `vega-lite` block's `data-spec` that does not already declare one. Task 3 extends the same private `rewriteChartSpec` with a title-stripping parameter.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/renderer.test.ts`, immediately after the closing `})` of the `describe('render: vega-lite fences', …)` block:

````ts
describe('render: chart width', () => {
  const fence = (spec: string) => '```vega-lite\n' + spec + '\n```'

  it('injects the default medium width when the spec declares none', () => {
    const html = render(fence('{"mark":"bar"}'))
    expect(html).toContain('&quot;width&quot;:400')
  })

  it('injects the requested width', () => {
    expect(render(fence('{"mark":"bar"}'), { chartWidth: 'small' })).toContain(
      '&quot;width&quot;:240',
    )
    expect(render(fence('{"mark":"bar"}'), { chartWidth: 'large' })).toContain(
      '&quot;width&quot;:560',
    )
  })

  it("leaves an author's explicit width alone", () => {
    const html = render(fence('{"mark":"bar","width":300}'), { chartWidth: 'large' })
    expect(html).toContain('&quot;width&quot;:300')
    expect(html).not.toContain('560')
  })

  it('passes unparseable spec text through untouched', () => {
    const html = render(fence('not json'))
    expect(html).toContain('not json')
    expect(html).not.toContain('width')
  })

  it('passes a spec that is not a JSON object through untouched', () => {
    const html = render(fence('[1, 2]'))
    expect(html).toContain('[1, 2]')
    expect(html).not.toContain('width')
  })
})
````

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd frontend && npx vitest run src/lib/renderer.test.ts)`
Expected: FAIL — `expected '…' to contain '&quot;width&quot;:400'` (no width is injected yet).

- [ ] **Step 3: Write the implementation**

In `frontend/src/lib/renderer.ts`, add the import beside the existing ones at the top:

```ts
import { chartWidthPx, type ChartWidth } from './figures'
```

Add this env interface just above `const md = new MarkdownIt(...)` (line 12):

```ts
/**
 * The per-render environment markdown-it threads through to the rules. Typed
 * once here rather than cast at each use: the fence renderer reads the chart
 * width out of it, and the source_line rule reads the frontmatter offset.
 */
interface RenderEnv {
  citations?: CitationCluster[]
  sourceLineOffset: number
  chartWidthPx: number
}
```

Replace the fence renderer (lines 36-48) with:

```ts
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim() !== 'vega-lite') return defaultFence(tokens, idx, options, env, self)

  // This branch builds its own HTML and never calls renderAttrs, so the
  // anchor the core rule set on the token has to be written out by hand.
  // Charts are the largest source of height divergence — the very reason
  // anchors beat a scroll ratio — so losing theirs would gut the feature.
  const line = token.attrGet('data-source-line') ?? ''
  const spec = rewriteChartSpec(token.content.trim(), (env as RenderEnv).chartWidthPx)
  return `<div class="vega-lite-chart" data-source-line="${md.utils.escapeHtml(line)}" data-spec="${md.utils.escapeHtml(spec)}"></div>\n`
}

/**
 * Render-time only: the document's text is never touched, so the chart
 * builder still reads the block's raw spec out of the editor. `width` is in
 * chartSpec.ts's passthrough allowlist, which is what makes an author's own
 * `"width": 300` survive a builder round trip and keep beating this default.
 *
 * Anything that is not a JSON object is returned verbatim, so a malformed
 * spec still reaches the hydrator's error card unchanged.
 */
function rewriteChartSpec(text: string, widthPx: number): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return text
  const spec = { ...(parsed as Record<string, unknown>) }
  if (!('width' in spec)) spec.width = widthPx
  return JSON.stringify(spec)
}
```

Replace `RenderOptions` and the head of `render` (lines 67-76) with:

```ts
export interface RenderOptions {
  formatter?: CitationFormatter
  /** Document-wide default width; a spec's own `width` still wins. */
  chartWidth?: ChartWidth
}

export function render(markdown: string, opts?: RenderOptions): string {
  const { body, bodyStartLine } = parseFrontmatter(markdown)
  const env: RenderEnv = {
    sourceLineOffset: bodyStartLine - 1,
    chartWidthPx: chartWidthPx(opts?.chartWidth),
  }
  let html = md.render(body, env)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run src/lib/renderer.test.ts && npm run check)`
Expected: PASS, including the pre-existing anchor and citation tests (`stamps vega-lite chart placeholders`, `renders documents without citations identically to the plain pipeline`), and no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/renderer.ts frontend/src/lib/renderer.test.ts
git commit -m "feat: give charts a document-wide default width"
```

---

### Task 3: Figures — numbering, captions, and one anchor per figure

**Files:**
- Modify: `frontend/src/lib/figures.ts` (append the plugin)
- Modify: `frontend/src/lib/renderer.ts` (use the plugin; wrap captioned charts)
- Modify: `frontend/src/lib/charts.ts:60-67` (clear a stale anchor off an adopted cached node)
- Test: `frontend/src/lib/figures.test.ts` (append), `frontend/src/lib/charts.test.ts` (append)

**Interfaces:**
- Consumes: `chartCaption`, `figureLabel` from Task 1; `rewriteChartSpec` from Task 2.
- Produces:
  - `interface FigureMeta { number: number; caption: string }`
  - `function figureOf(token: Token): FigureMeta | null` — reads the stamp the core rule left on a token.
  - `function figurePlugin(md: MarkdownIt): void` — registers the `figures` core rule and the `figcaption` renderer rule.
  - `rewriteChartSpec(text, widthPx, stripTitle)` gains its third parameter.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/figures.test.ts`:

````ts
// The plugin is exercised through render() rather than against tokens
// directly: what matters is the HTML a document produces, and that is also
// the only place the fence renderer's half of the work shows up.
import { render } from './renderer'

const fence = (spec: string) => '```vega-lite\n' + spec + '\n```'

describe('figures: what becomes one', () => {
  it('captions a chart whose spec has a title', () => {
    const html = render(fence('{"title":"Recovered sources","mark":"bar"}'))
    expect(html).toContain('<figure')
    expect(html).toContain('<figcaption>Figure 1 — Recovered sources</figcaption>')
  })

  it('accepts all three title shapes', () => {
    expect(render(fence('{"title":{"text":"Sources"},"mark":"bar"}'))).toContain(
      'Figure 1 — Sources',
    )
    expect(render(fence('{"title":{"text":["one","two"]},"mark":"bar"}'))).toContain(
      'Figure 1 — one two',
    )
  })

  it('leaves an untitled chart exactly as it was', () => {
    const html = render(fence('{"mark":"bar"}'))
    expect(html).toContain('class="vega-lite-chart"')
    expect(html).not.toContain('<figure')
    expect(html).not.toContain('<figcaption')
  })

  it('leaves a chart with an unusable title shape alone', () => {
    expect(render(fence('{"title":42,"mark":"bar"}'))).not.toContain('<figure')
    expect(render(fence('{"title":null,"mark":"bar"}'))).not.toContain('<figure')
  })

  it('leaves an unparseable chart alone, still as a chart placeholder', () => {
    const html = render(fence('not json'))
    expect(html).not.toContain('<figure')
    expect(html).toContain('class="vega-lite-chart"')
  })

  it('captions an image that is alone in its paragraph', () => {
    const html = render('![Recovered map](map.png)\n')
    expect(html).toContain('<figure')
    expect(html).toContain('<figcaption>Figure 1 — Recovered map</figcaption>')
  })

  it('keeps the alt attribute as well as adding the caption', () => {
    // The two serve different readers: the caption is visible to everyone,
    // the alt describes the image when it fails to load or is read aloud.
    const html = render('![Recovered map](map.png)\n')
    expect(html).toContain('alt="Recovered map"')
  })

  it('leaves an empty-alt image decorative and unnumbered', () => {
    const html = render('![](spacer.png)\n')
    expect(html).not.toContain('<figure')
    expect(html).toContain('<p data-source-line="1"')
  })

  it('leaves a linked image alone — only a bare image qualifies', () => {
    const html = render('[![Recovered map](map.png)](https://example.com)\n')
    expect(html).not.toContain('<figure')
  })

  it('leaves two images in one paragraph alone — ambiguous which is captioned', () => {
    const html = render('![one](a.png) ![two](b.png)\n')
    expect(html).not.toContain('<figure')
  })

  it('leaves an image with surrounding text alone', () => {
    const html = render('See ![one](a.png) here.\n')
    expect(html).not.toContain('<figure')
  })
})

describe('figures: numbering', () => {
  it('numbers charts and images in one sequence, in document order', () => {
    const doc =
      fence('{"title":"Sources","mark":"bar"}') +
      '\n\n![Recovered map](map.png)\n\n' +
      fence('{"title":"Yield","mark":"line"}')
    const html = render(doc)
    expect(html).toContain('Figure 1 — Sources')
    expect(html).toContain('Figure 2 — Recovered map')
    expect(html).toContain('Figure 3 — Yield')
  })

  it('does not spend a number on an uncaptioned block', () => {
    const doc = fence('{"mark":"bar"}') + '\n\n![Recovered map](map.png)\n'
    expect(render(doc)).toContain('Figure 1 — Recovered map')
  })

  it('renumbers everything below a figure inserted above them', () => {
    const below = '![Recovered map](map.png)\n'
    expect(render(below)).toContain('Figure 1 — Recovered map')
    expect(render('![Overview](overview.png)\n\n' + below)).toContain(
      'Figure 2 — Recovered map',
    )
  })
})

describe('figures: the title never renders twice', () => {
  it('strips the title from the spec handed to the hydrator', () => {
    // Left in, Vega-Lite draws the caption inside the SVG as well.
    const html = render(fence('{"title":"Sources","mark":"bar"}'))
    expect(html).not.toContain('&quot;title&quot;')
    expect(html).toContain('Figure 1 — Sources')
  })

  it('leaves the title in place on a chart that is not a figure', () => {
    // No caption is drawn below it, so the in-SVG title is all there is.
    const html = render(fence('{"title":42,"mark":"bar"}'))
    expect(html).toContain('&quot;title&quot;')
  })
})

describe('figures: scroll-sync anchors', () => {
  it('gives a chart figure exactly one data-source-line', () => {
    // collectAnchors() takes every [data-source-line] as an anchor, so an
    // attribute on both the <figure> and its child would be two anchors for
    // one source line at different offsets — a degenerate interpolation
    // segment for previewOffsetForLine.
    const html = render(fence('{"title":"Sources","mark":"bar"}'))
    expect(html.match(/data-source-line/g)).toHaveLength(1)
    expect(html).toMatch(/<figure data-source-line="1"/)
  })

  it('gives an image figure exactly one data-source-line', () => {
    const html = render('![Recovered map](map.png)\n')
    expect(html.match(/data-source-line/g)).toHaveLength(1)
    expect(html).toMatch(/<figure data-source-line="1"/)
  })

  it('anchors a figure past the frontmatter, like every other block', () => {
    const html = render('---\ncsl: apa\n---\n\n![Recovered map](map.png)\n')
    expect(html).toMatch(/<figure data-source-line="5"/)
  })
})

describe('figures: caption text is escaped', () => {
  it('escapes HTML-significant characters in a chart caption', () => {
    const html = render(fence('{"title":"a <b> & c","mark":"bar"}'))
    expect(html).toContain('&lt;b&gt; &amp; c')
    expect(html).not.toContain('<b>')
  })

  it('escapes HTML-significant characters in an image caption', () => {
    const html = render('![a <b> & c](map.png)\n')
    expect(html).toContain('&lt;b&gt; &amp; c')
    expect(html).not.toContain('<b>')
  })
})
````

Append to `frontend/src/lib/charts.test.ts`, inside the `describe('createChartHydrator: caching', …)` block (before its closing `})`):

```ts
  it('drops a stale anchor when the adopted node lands inside a figure', () => {
    // Stripping the title makes a captioned chart's data-spec identical to
    // the same chart uncaptioned, so the cache can hand a node embedded as a
    // bare placeholder (anchor on the div) to a placeholder inside a
    // <figure> (anchor on the figure). Left on, that is two anchors for one
    // source line.
    return (async () => {
      const embed = fakeEmbed()
      const h = createChartHydrator(embed.fn)
      const specAttr = SPEC.replace(/"/g, '&quot;')

      const first = containerWith(
        `<div class="vega-lite-chart" data-source-line="4" data-spec="${specAttr}"></div>`,
      )
      await h.hydrate(first)

      const second = containerWith(
        `<figure data-source-line="4"><div class="vega-lite-chart" data-spec="${specAttr}"></div></figure>`,
      )
      await h.hydrate(second)

      expect(second.querySelectorAll('[data-source-line]')).toHaveLength(1)
      expect(
        second.querySelector<HTMLElement>('.vega-lite-chart')!.dataset.sourceLine,
      ).toBeUndefined()
    })()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `(cd frontend && npx vitest run src/lib/figures.test.ts src/lib/charts.test.ts)`
Expected: FAIL — `render` produces no `<figure>`, and the hydrator leaves `data-sourceLine="4"` on the adopted node.

- [ ] **Step 3: Write the implementation**

Append to `frontend/src/lib/figures.ts`:

```ts
import type MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type Token from 'markdown-it/lib/token.mjs'

/** What the numbering pass stamps onto a token it decided is a figure. */
export interface FigureMeta {
  number: number
  caption: string
}

/** Reads that stamp back, for a renderer that hand-builds its own HTML. */
export function figureOf(token: Token): FigureMeta | null {
  const meta = token.meta as { figure?: FigureMeta } | null | undefined
  return meta?.figure ?? null
}

/**
 * Numbers figures and builds them.
 *
 * The pass needs no persistent state: render() re-runs on every debounced
 * change, so the count is recomputed each time and inserting a figure
 * renumbers everything below it on the next keystroke.
 *
 * Charts are only *stamped* here — they are emitted by renderer.ts's fence
 * renderer, which already hand-builds their HTML. Images need token surgery
 * instead: a <figure> cannot live inside the <p> markdown-it wraps them in,
 * so the paragraph tokens become figure tokens with a figcaption appended.
 */
export function figurePlugin(md: MarkdownIt): void {
  md.core.ruler.push('figures', numberFigures)
  md.renderer.rules.figcaption = (tokens, idx) =>
    `<figcaption>${md.utils.escapeHtml(tokens[idx].content)}</figcaption>`
}

function numberFigures(state: StateCore): boolean {
  let count = 0
  for (let i = 0; i < state.tokens.length; i++) {
    const token = state.tokens[i]
    // Only top-level blocks are figures — the same level-0 restriction the
    // source_line rule uses, so a chart quoted inside a blockquote or a list
    // item stays a plain chart rather than claiming a figure number.
    if (token.level !== 0) continue

    if (token.type === 'fence' && token.info.trim() === 'vega-lite') {
      const caption = chartCaption(token.content)
      if (caption === '') continue
      count += 1
      token.meta = { ...(token.meta ?? {}), figure: { number: count, caption } }
      continue
    }

    if (token.type !== 'paragraph_open') continue
    const inline = state.tokens[i + 1]
    const close = state.tokens[i + 2]
    if (inline?.type !== 'inline' || close?.type !== 'paragraph_close') continue

    // Exactly one child, and it an image: a linked image is [link_open,
    // image, link_close], and two images (or an image with prose) leave text
    // tokens beside it. markdown-it's text_collapse rule has already removed
    // empty text tokens by the time a pushed core rule runs, so a lone image
    // really is a single child.
    const children = inline.children ?? []
    if (children.length !== 1 || children[0].type !== 'image') continue

    // renderInlineAsText is how markdown-it's own image renderer derives the
    // alt attribute, so this is the same text the <img> will carry.
    const alt = state.md.renderer
      .renderInlineAsText(children[0].children ?? [], state.md.options, state.env)
      .trim()
    // Empty alt stays decorative and unnumbered — the accessibility
    // convention, and it stops a spacer image consuming a figure number.
    if (alt === '') continue

    count += 1
    // Retagging keeps the paragraph's attributes, which is exactly what is
    // wanted: data-source-line moves onto the <figure> and off nothing else,
    // because the <img> never carried one.
    token.tag = 'figure'
    close.tag = 'figure'
    const caption = new state.Token('figcaption', 'figcaption', 0)
    caption.content = figureLabel(count, alt)
    state.tokens.splice(i + 2, 0, caption)
  }
  return true
}
```

In `frontend/src/lib/renderer.ts`, extend the import added in Task 2:

```ts
import { chartWidthPx, figureLabel, figureOf, figurePlugin, type ChartWidth } from './figures'
```

Register the plugin immediately after the `source_line` core rule block (after line 34's `})`), so it runs with the anchor already stamped:

```ts
// Pushed after source_line so a paragraph that becomes a <figure> already
// carries its anchor, and the retag carries it along.
md.use(figurePlugin)
```

Replace the fence renderer body from Task 2 with:

```ts
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim() !== 'vega-lite') return defaultFence(tokens, idx, options, env, self)

  // This branch builds its own HTML and never calls renderAttrs, so the
  // anchor the core rule set on the token has to be written out by hand.
  // Charts are the largest source of height divergence — the very reason
  // anchors beat a scroll ratio — so losing theirs would gut the feature.
  const anchor = ` data-source-line="${md.utils.escapeHtml(token.attrGet('data-source-line') ?? '')}"`
  const figure = figureOf(token)
  const spec = md.utils.escapeHtml(
    rewriteChartSpec(token.content.trim(), (env as RenderEnv).chartWidthPx, figure !== null),
  )
  if (!figure) return `<div class="vega-lite-chart"${anchor} data-spec="${spec}"></div>\n`

  // The anchor moves ONTO the <figure> and must not stay on the child:
  // collectAnchors takes every [data-source-line] as an anchor, and two at
  // different offsets for one source line is a degenerate segment for
  // previewOffsetForLine to interpolate across.
  const caption = md.utils.escapeHtml(figureLabel(figure.number, figure.caption))
  return (
    `<figure${anchor}>` +
    `<div class="vega-lite-chart" data-spec="${spec}"></div>` +
    `<figcaption>${caption}</figcaption>` +
    `</figure>\n`
  )
}
```

Extend `rewriteChartSpec` with the title lift — replace its signature, doc comment and body with:

```ts
/**
 * Render-time only: the document's text is never touched, so the chart
 * builder still reads the block's raw spec out of the editor. `title` and
 * `width` are both in chartSpec.ts's passthrough allowlist, which is what
 * makes a builder round trip preserve them and an author's own `"width": 300`
 * keep beating the document default.
 *
 * The title is removed when the caption is being drawn below the chart —
 * otherwise Vega-Lite draws it inside the SVG as well and it appears twice.
 *
 * Anything that is not a JSON object is returned verbatim, so a malformed
 * spec still reaches the hydrator's error card unchanged.
 */
function rewriteChartSpec(text: string, widthPx: number, stripTitle: boolean): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return text
  const spec = { ...(parsed as Record<string, unknown>) }
  if (stripTitle) delete spec.title
  if (!('width' in spec)) spec.width = widthPx
  return JSON.stringify(spec)
}
```

In `frontend/src/lib/charts.ts`, replace the cached-node anchor block (lines 60-67):

```ts
          // The cached node still carries the source line it was rendered at.
          // Editing above the chart moves it, so adopt the fresh placeholder's
          // line — otherwise scroll sync desynchronises from here down while
          // the chart itself still looks perfectly correct.
          if (el.dataset.sourceLine !== undefined) {
            cached.dataset.sourceLine = el.dataset.sourceLine
          } else {
            // A captioned chart's placeholder carries no anchor: it moved to
            // the wrapping <figure>. Since the caption is stripped out of
            // data-spec, that placeholder's spec text is identical to the
            // same chart uncaptioned — so a cached node from the uncaptioned
            // form can legitimately be adopted here, still carrying its old
            // line. Left on, the figure and its child are two anchors for one
            // source line.
            delete cached.dataset.sourceLine
          }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run && npm run check)`
Expected: PASS across the whole suite — in particular `renderer.test.ts`'s `stamps vega-lite chart placeholders` and `keeps anchors out of inline content`, and `charts.test.ts`'s existing anchor-adoption test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/figures.ts frontend/src/lib/figures.test.ts frontend/src/lib/renderer.ts frontend/src/lib/charts.ts frontend/src/lib/charts.test.ts
git commit -m "feat: number and caption figures from a chart title or image alt"
```

---

### Task 4: The two settings, in Go

**Files:**
- Modify: `settings.go:15-39` (`Settings`, `defaultSettings`, `normalise`)
- Modify: `frontend/bindings/hermes/models.ts` — **regenerated, never hand-edited**
- Test: `settings_test.go` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `Settings.FigureAlignment string \`json:"figureAlignment"\`` (`left`/`centre`/`right`, default `centre`) and `Settings.ChartWidth string \`json:"chartWidth"\`` (`small`/`medium`/`large`, default `medium`). The regenerated `Settings` TS interface gains `"figureAlignment": string` and `"chartWidth": string`.

- [ ] **Step 1: Write the failing tests**

Append to `settings_test.go`:

```go
func TestFigureSettingsDefaults(t *testing.T) {
	s := newTestService(t)
	got := s.Settings()
	if got.FigureAlignment != "centre" {
		t.Errorf("want centre default, got %q", got.FigureAlignment)
	}
	if got.ChartWidth != "medium" {
		t.Errorf("want medium default, got %q", got.ChartWidth)
	}
}

func TestFigureSettingsPersist(t *testing.T) {
	recentsPath := filepath.Join(t.TempDir(), "recents.json")
	s := NewDocumentService(recentsPath)

	next := s.Settings()
	next.FigureAlignment = "left"
	next.ChartWidth = "large"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}

	got := NewDocumentService(recentsPath).Settings()
	if got.FigureAlignment != "left" || got.ChartWidth != "large" {
		t.Errorf("want the pair persisted across instances, got %+v", got)
	}
}

func TestFigureAlignmentNormalisesUnknownValues(t *testing.T) {
	s := newTestService(t)
	for _, bad := range []string{"", "center", "CENTRE", "justified"} {
		if err := s.UpdateSettings(Settings{FigureAlignment: bad}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", bad, err)
		}
		if got := s.Settings().FigureAlignment; got != "centre" {
			t.Errorf("want %q normalised to centre, got %q", bad, got)
		}
	}
}

func TestChartWidthNormalisesUnknownValues(t *testing.T) {
	s := newTestService(t)
	for _, bad := range []string{"", "enormous", "MEDIUM", "400"} {
		if err := s.UpdateSettings(Settings{ChartWidth: bad}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", bad, err)
		}
		if got := s.Settings().ChartWidth; got != "medium" {
			t.Errorf("want %q normalised to medium, got %q", bad, got)
		}
	}
}

func TestFigureSettingsAcceptEveryLegalValue(t *testing.T) {
	s := newTestService(t)
	for _, want := range []string{"left", "centre", "right"} {
		if err := s.UpdateSettings(Settings{FigureAlignment: want}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", want, err)
		}
		if got := s.Settings().FigureAlignment; got != want {
			t.Errorf("want %q preserved, got %q", want, got)
		}
	}
	for _, want := range []string{"small", "medium", "large"} {
		if err := s.UpdateSettings(Settings{ChartWidth: want}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", want, err)
		}
		if got := s.Settings().ChartWidth; got != want {
			t.Errorf("want %q preserved, got %q", want, got)
		}
	}
}

func TestFigureSettingsAreIndependentOfTheOthers(t *testing.T) {
	s := newTestService(t)
	if err := s.UpdateSettings(Settings{
		PrintOrientation: "landscape",
		SyncScrolling:    true,
		Theme:            "dark",
		FigureAlignment:  "right",
		ChartWidth:       "small",
	}); err != nil {
		t.Fatal(err)
	}
	next := s.Settings()
	next.ChartWidth = "large"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	got := s.Settings()
	if got.PrintOrientation != "landscape" || !got.SyncScrolling ||
		got.Theme != "dark" || got.FigureAlignment != "right" {
		t.Errorf("changing the chart width disturbed the other settings: %+v", got)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./.`
Expected: FAIL to compile — `unknown field FigureAlignment in struct literal of type Settings`.

- [ ] **Step 3: Write the implementation**

In `settings.go`, extend the struct (lines 15-19):

```go
type Settings struct {
	PrintOrientation string `json:"printOrientation"`
	SyncScrolling    bool   `json:"syncScrolling"`
	Theme            string `json:"theme"`
	FigureAlignment  string `json:"figureAlignment"`
	ChartWidth       string `json:"chartWidth"`
}
```

Extend `defaultSettings`:

```go
func defaultSettings() Settings {
	return Settings{
		PrintOrientation: "portrait",
		SyncScrolling:    false,
		Theme:            "system",
		FigureAlignment:  "centre",
		ChartWidth:       "medium",
	}
}
```

Extend `normalise`, before its `return s`:

```go
	// Hermes spells this `centre` throughout; the frontend maps it to CSS's
	// `center` at the boundary, so `center` is not a legal value here.
	if s.FigureAlignment != "left" && s.FigureAlignment != "centre" && s.FigureAlignment != "right" {
		s.FigureAlignment = defaultSettings().FigureAlignment
	}
	if s.ChartWidth != "small" && s.ChartWidth != "medium" && s.ChartWidth != "large" {
		s.ChartWidth = defaultSettings().ChartWidth
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./. && go build -o /dev/null .`
Expected: PASS, including every pre-existing settings test.

- [ ] **Step 5: Regenerate the bindings**

Run: `wails3 task common:generate:bindings`
Expected: `frontend/bindings/hermes/models.ts`'s `Settings` interface now has `"figureAlignment": string;` and `"chartWidth": string;`. Confirm with `git diff frontend/bindings`. Do not edit the file by hand.

- [ ] **Step 6: Commit**

```bash
git add settings.go settings_test.go frontend/bindings
git commit -m "feat: persist figure alignment and chart width"
```

---

### Task 5: The two View submenus

**Files:**
- Modify: `menu.go:180-181` (insert after the Appearance loop, before the fold separator)

**Interfaces:**
- Consumes: `Settings.FigureAlignment`, `Settings.ChartWidth` from Task 4.
- Produces: nothing the frontend imports — the menu writes through `docs.UpdateSettings`, and the existing `settings:changed` event carries the result.

- [ ] **Step 1: Write the implementation**

There is no automated test here: the project has no menu test, and AppKit menu construction cannot be exercised headlessly (the same honest limit the design records for theme appearance). It is verified by build and by the manual check in Task 9.

In `menu.go`, insert immediately after the Appearance `for` loop closes (line 180) and before `view.AddSeparator()` on line 182:

```go
	// Both read viewCurrent, the settings snapshot taken at the top of this
	// View block. Each OnClick re-reads and read-modify-writes the whole
	// value, so a submenu only ever changes the one field it owns.
	alignmentMenu := view.AddSubmenu("Figure Alignment")
	alignments := []struct {
		label string
		value string
	}{
		{"Left", "left"},
		{"Centre", "centre"},
		{"Right", "right"},
	}
	for _, a := range alignments {
		value := a.value
		alignmentMenu.AddRadio(a.label, viewCurrent.FigureAlignment == value).OnClick(func(*application.Context) {
			next := docs.Settings()
			next.FigureAlignment = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save figure alignment: %v", err)
			}
		})
	}

	widthMenu := view.AddSubmenu("Chart Width")
	widths := []struct {
		label string
		value string
	}{
		{"Small", "small"},
		{"Medium", "medium"},
		{"Large", "large"},
	}
	for _, w := range widths {
		value := w.value
		widthMenu.AddRadio(w.label, viewCurrent.ChartWidth == value).OnClick(func(*application.Context) {
			next := docs.Settings()
			next.ChartWidth = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save chart width: %v", err)
			}
		})
	}
```

- [ ] **Step 2: Verify it builds and nothing else broke**

Run: `go test ./. && go build -o /dev/null .`
Expected: PASS, clean build.

- [ ] **Step 3: Commit**

```bash
git add menu.go
git commit -m "feat: add View submenus for figure alignment and chart width"
```

---

### Task 6: Wire the settings into the preview

**Files:**
- Modify: `frontend/src/Preview.svelte:7-13` (props), `:72` (the pane element)
- Modify: `frontend/src/App.svelte` — imports (~line 34), state (~line 49), the four `render()` call sites (lines 72, 138, 307, 366), `refreshSettings` (line 315), the `<Preview>` tag (line 567)
- Test: `frontend/src/Preview.test.ts` (append), `frontend/src/App.test.ts` (modify the hoisted settings block and its eight assignments; append one test)

**Interfaces:**
- Consumes: `cssTextAlign`, `type ChartWidth`, `type FigureAlignment` from Task 1; `RenderOptions.chartWidth` from Task 2; the two `Settings` fields from Task 4.
- Produces: `Preview` gains an optional `figureAlign?: string` prop (default `'centre'`) and renders `data-figure-align` on `.preview-pane` with the CSS spelling. Task 7's stylesheet keys off that attribute.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/Preview.test.ts`:

```ts
describe('Preview figure alignment', () => {
  it('publishes the alignment on the pane, in CSS spelling', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(Preview, {
      target,
      props: { html: '<p>x</p>', figureAlign: 'centre', collectAnchorsFn: () => [] },
    })
    flushSync()
    const pane = target.querySelector('.preview-pane') as HTMLElement
    // `centre` is Hermes' spelling; the stylesheet can only match `center`.
    expect(pane.dataset.figureAlign).toBe('center')
    unmount(cmp)
    target.remove()
  })

  it('defaults to centre when no alignment is supplied', () => {
    const { pane, cleanup } = mountPreview('<p>x</p>')
    expect(pane.dataset.figureAlign).toBe('center')
    cleanup()
  })
})
```

In `frontend/src/App.test.ts`, replace the `settings` entry of the `vi.hoisted` block (lines 9-11) with:

```ts
  const DEFAULT_SETTINGS = {
    printOrientation: 'portrait',
    syncScrolling: false,
    theme: 'system',
    figureAlignment: 'centre',
    chartWidth: 'medium',
  }
  const settings = { current: { ...DEFAULT_SETTINGS } }
```

and add `DEFAULT_SETTINGS` to both the returned object and the destructuring on line 6, so the header reads:

```ts
const { DocumentService, listeners, recents, settings, DEFAULT_SETTINGS } = vi.hoisted(() => {
```

with `DEFAULT_SETTINGS,` added to the `return { … }` beside `settings,`.

Then rewrite the eight `settings.current = …` assignments to spread it:

| Line | New text |
|---|---|
| 205 | `settings.current = { ...DEFAULT_SETTINGS }` |
| 220 | `settings.current = { ...DEFAULT_SETTINGS, syncScrolling: true }` |
| 227 | `settings.current = { ...DEFAULT_SETTINGS }` |
| 233 | `settings.current = { ...DEFAULT_SETTINGS, syncScrolling: true }` |
| 243 | `settings.current = { ...DEFAULT_SETTINGS, theme: 'dark' }` |
| 254 | `settings.current = { ...DEFAULT_SETTINGS }` |
| 267 | `settings.current = { ...DEFAULT_SETTINGS, theme: 'light' }` |
| 286 | `settings.current = { ...DEFAULT_SETTINGS }` |

(Line numbers are from before the hoisted-block edit; match on the text, which is unique per line only in combination with its surrounding test — work top to bottom.)

Append a new describe block to `frontend/src/App.test.ts`:

```ts
describe('figure settings', () => {
  it('publishes the persisted alignment onto the preview pane', async () => {
    settings.current = { ...DEFAULT_SETTINGS, figureAlignment: 'right' }
    recents.current = []
    stubMatchMedia(false)
    const { target } = mountApp()

    await vi.waitFor(() =>
      expect(
        target.querySelector<HTMLElement>('.preview-pane')!.dataset.figureAlign,
      ).toBe('right'),
    )
  })

  it('re-renders the preview when the menu changes the chart width', async () => {
    settings.current = { ...DEFAULT_SETTINGS }
    recents.current = []
    stubMatchMedia(false)
    const { target } = mountApp()
    const pane = target.querySelector<HTMLElement>('.preview-pane')!

    // A chart in the document is what makes the width observable at all.
    const editor = EditorView.findFromDOM(target.querySelector('.cm-editor')!)!
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: '```vega-lite\n{"mark":"bar"}\n```\n' },
    })
    await vi.waitFor(() =>
      expect(pane.querySelector('.vega-lite-chart')?.getAttribute('data-spec')).toContain(
        '"width":400',
      ),
    )

    settings.current = { ...DEFAULT_SETTINGS, chartWidth: 'large' }
    listeners['settings:changed']({ data: null })

    await vi.waitFor(() =>
      expect(pane.querySelector('.vega-lite-chart')?.getAttribute('data-spec')).toContain(
        '"width":560',
      ),
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `(cd frontend && npx vitest run src/Preview.test.ts src/App.test.ts)`
Expected: FAIL — `expected undefined to be 'center'`; the App tests fail on the missing `data-figure-align` and on the width never changing.

- [ ] **Step 3: Write the implementation**

In `frontend/src/Preview.svelte`, add the import beside the others:

```ts
  import { cssTextAlign } from './lib/figures'
```

Replace the props block (lines 7-13):

```ts
  let {
    html,
    /** Hermes spelling ('left' | 'centre' | 'right'); mapped to CSS below. */
    figureAlign = 'centre',
    // Injectable so tests can supply known anchors: jsdom has no layout engine
    // and would measure every element at zero. Mirrors createChartHydrator's
    // embed parameter, which exists for the same reason.
    collectAnchorsFn = collectAnchors,
  }: {
    html: string
    figureAlign?: string
    collectAnchorsFn?: (c: HTMLElement) => Anchor[]
  } = $props()
```

Replace the pane element (line 72):

```svelte
<div
  class="preview-pane"
  data-figure-align={cssTextAlign(figureAlign)}
  bind:this={container}
  onclick={onPreviewClick}
></div>
```

In `frontend/src/App.svelte`, extend the imports (after line 34):

```ts
  import type { ChartWidth, FigureAlignment } from './lib/figures'
```

Add state beside `themeSetting` (after line 49):

```ts
  let chartWidth = $state<ChartWidth>('medium')
  let figureAlign = $state<FigureAlignment>('centre')
```

Add `chartWidth` to all four `render()` calls:

- line 72 (inside `updatePreview`): `html = render(text, { formatter, chartWidth })`
- line 138 (the re-render effect): see below
- line 307 (in `loadDocument`): `html = render(docContent, { formatter, chartWidth })`
- line 366 (in `doNew`): `html = render(NEW_DOCUMENT_TEMPLATE, { formatter, chartWidth })`

Replace the re-render effect (lines 133-139):

```ts
  // Re-render when the FORMATTER or the chart width changes (bib loaded or
  // reloaded, style change, View → Chart Width). content is read untracked:
  // content changes flow through the debounced typing path, not this
  // immediate effect.
  $effect(() => {
    void formatter
    void chartWidth
    html = render(untrack(() => content), { formatter, chartWidth })
  })
```

Extend `refreshSettings` (lines 315-320):

```ts
  async function refreshSettings() {
    const s: Settings = await DocumentService.Settings()
    syncScrolling = s.syncScrolling
    themeSetting = s.theme as ThemeSetting
    // Go normalises both on the way out, so the cast is a spelling of what
    // the binding cannot express rather than an unchecked assumption.
    chartWidth = s.chartWidth as ChartWidth
    figureAlign = s.figureAlignment as FigureAlignment
    applyTheme(resolveTheme(themeSetting, systemPrefersDark))
  }
```

Pass the alignment to Preview (line 567):

```svelte
    <Preview bind:this={preview} {html} {figureAlign} />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run && npm run check)`
Expected: PASS across the whole suite, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.svelte frontend/src/App.test.ts frontend/src/Preview.svelte frontend/src/Preview.test.ts
git commit -m "feat: apply the figure alignment and chart width settings to the preview"
```

---

### Task 7: Figure styling — alignment, overflow, print

**Files:**
- Modify: `frontend/public/style.css` — a new figure block after the existing `.preview-pane img` mount rule (line 179), and one addition to the `@media print` break-inside list (line 357)
- Test: `frontend/src/lib/styleContract.test.ts` (append)

**Interfaces:**
- Consumes: the `data-figure-align` attribute Preview writes in Task 6, and the `<figure>`/`<figcaption>` markup from Task 3.
- Produces: nothing importable.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/styleContract.test.ts`:

```ts
describe('figure alignment', () => {
  it('never spells the alignment the British way in a rule', () => {
    // Hermes' own identifier is `centre`; CSS's keyword — and therefore the
    // attribute value Preview.svelte writes — is `center`. A `centre` in a
    // rule means cssTextAlign was bypassed, and centring silently does
    // nothing at all. Comments are stripped first: the prose here is free to
    // explain the mapping using both spellings.
    expect(stripComments(CSS)).not.toContain('centre')
  })

  it('styles all three alignments', () => {
    for (const value of ['left', 'center', 'right']) {
      expect(CSS).toContain(`[data-figure-align="${value}"]`)
    }
  })

  it('keeps a caption on the same page as its figure when printing', () => {
    // Without this a caption orphans onto the next page — a failure the
    // in-SVG title did not have.
    const print = CSS.slice(CSS.indexOf('@media print'))
    expect(print).toMatch(/figure[^{]*\{[^}]*break-inside: avoid/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(cd frontend && npx vitest run src/lib/styleContract.test.ts)`
Expected: FAIL — `expected '…' to contain '[data-figure-align="left"]'`.

- [ ] **Step 3: Write the implementation**

In `frontend/public/style.css`, insert after the `.preview-pane .vega-lite-chart, .preview-pane img { … }` mount rule (after line 179):

```css
/* A figure is a caption plus what it captions; the caption is real text in
   the HTML, not a CSS counter, so it survives copy-paste and PDF extraction. */
.preview-pane figure { margin-bottom: 0.9em; }
.preview-pane figcaption {
  margin-top: 0.5em;
  font-size: 0.9em;
  color: var(--muted-strong);
}

/* A fixed-width chart can exceed a narrowed preview pane, and .preview-pane
   scrolls — so without this the whole pane scrolls sideways. Scaling an
   oversized chart down shrinks its label text slightly at extreme pane
   widths; that is the better failure. */
.preview-pane .vega-lite-chart svg { max-width: 100%; height: auto; }

/* Figure alignment, driven by one attribute on the preview root rather than a
   class injected per element. Charts and images are listed alongside `figure`
   so alignment applies whether or not the block is captioned — alignment is
   about the figure, not the caption. A figure's own chart div matches twice,
   which is harmless: text-align inherits and the inner value equals the outer.

   `p:has(> img:only-child)` is how an UNcaptioned image gets aligned:
   text-align positions a block's inline children, and an <img> is itself one,
   so the property has to sit on the paragraph markdown-it wrapped it in. The
   :only-child test is what keeps ordinary prose — and an image used inline in
   a sentence — out of it.

   The attribute value is CSS's `center`, not Hermes' `centre`;
   Preview.svelte maps between them through cssTextAlign(). */
.preview-pane[data-figure-align="left"] figure,
.preview-pane[data-figure-align="left"] .vega-lite-chart,
.preview-pane[data-figure-align="left"] p:has(> img:only-child) { text-align: left; }

.preview-pane[data-figure-align="center"] figure,
.preview-pane[data-figure-align="center"] .vega-lite-chart,
.preview-pane[data-figure-align="center"] p:has(> img:only-child) { text-align: center; }

.preview-pane[data-figure-align="right"] figure,
.preview-pane[data-figure-align="right"] .vega-lite-chart,
.preview-pane[data-figure-align="right"] p:has(> img:only-child) { text-align: right; }
```

Extend the print break-inside rule (line 357) with `figure`:

```css
  .katex-display, .vega-lite-chart, figure, .chart-error, .csl-entry { break-inside: avoid; }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run src/lib/styleContract.test.ts)`
Expected: PASS — including the pre-existing `declares no literal colours outside the palette` and the light/dark/print parity checks, which the new rules must not disturb (they add no variables and use only `var(--muted-strong)`).

- [ ] **Step 5: Commit**

```bash
git add frontend/public/style.css frontend/src/lib/styleContract.test.ts
git commit -m "feat: align, size-guard and page-break figures in the preview"
```

---

### Task 8: A Caption field in the chart builder

**Files:**
- Modify: `frontend/src/ChartBuilder.svelte` — imports (line 4), `Seed` (lines 20-32), `seed` (lines 47-70), state (~line 135), `builderState` (lines 176-190), the embed effect (lines 201-219), the encode-step markup (line 271), below the preview (line 324)
- Modify: `frontend/public/style.css` — two rules beside the other `.chart-builder` rules
- Test: `frontend/src/ChartBuilder.test.ts` (append)

**Interfaces:**
- Consumes: `captionFromTitle` from Task 1; `BuilderState.extras` and `PASSTHROUGH_KEYS`'s `title` from the existing `lib/chartSpec.ts` (unchanged — `title` is already carried through a round trip, which is what makes this work with no change there).
- Produces: nothing importable. The committed spec's `extras.title` is a plain string.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/ChartBuilder.test.ts`:

```ts
/** Types into a text input the way a user would. */
function typeInto(target: HTMLElement, field: string, value: string) {
  const el = target.querySelector<HTMLInputElement>(`input[data-field="${field}"]`)!
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

/** A ready-to-commit builder: data pasted and both axes chosen. */
function readyBuilder(oncommit = vi.fn()) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const cmp = mount(ChartBuilder, {
    target,
    props: { initial: null, oncommit, oncancel: vi.fn() },
  })
  flushSync()
  paste(target, 'dose,response\n0,1\n5,2\n')
  select(target, 'x', 'dose')
  select(target, 'y', 'response')
  return {
    target,
    oncommit,
    commit: () => {
      const button = [...target.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Insert chart',
      )!
      button.click()
      flushSync()
    },
    cleanup: () => {
      unmount(cmp)
      target.remove()
    },
  }
}

describe('ChartBuilder caption', () => {
  it('writes the caption into the spec title, where the renderer reads it', () => {
    const b = readyBuilder()
    typeInto(b.target, 'caption', 'Recovered sources')
    b.commit()
    const spec = JSON.parse(b.oncommit.mock.calls[0][0] as string)
    expect(spec.title).toBe('Recovered sources')
    b.cleanup()
  })

  it('commits no title at all when the caption is left empty', () => {
    const b = readyBuilder()
    b.commit()
    const spec = JSON.parse(b.oncommit.mock.calls[0][0] as string)
    expect('title' in spec).toBe(false)
    b.cleanup()
  })

  it('prefills the caption when reopening a captioned chart', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(ChartBuilder, {
      target,
      props: {
        initial: {
          mark: 'bar' as const,
          rows: [{ dose: 0, response: 1 }],
          x: { field: 'dose', type: 'quantitative' as const, title: '' },
          y: {
            field: 'response',
            type: 'quantitative' as const,
            title: '',
            aggregate: 'none' as const,
          },
          colour: null,
          extras: { title: 'Recovered sources' },
        },
        oncommit: vi.fn(),
        oncancel: vi.fn(),
      },
    })
    flushSync()
    expect(target.querySelector<HTMLInputElement>('input[data-field="caption"]')!.value).toBe(
      'Recovered sources',
    )
    unmount(cmp)
    target.remove()
  })

  it('clears the title when the caption is emptied', () => {
    const oncommit = vi.fn()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(ChartBuilder, {
      target,
      props: {
        initial: {
          mark: 'bar' as const,
          rows: [{ dose: 0, response: 1 }],
          x: { field: 'dose', type: 'quantitative' as const, title: '' },
          y: {
            field: 'response',
            type: 'quantitative' as const,
            title: '',
            aggregate: 'none' as const,
          },
          colour: null,
          extras: { title: 'Recovered sources' },
        },
        oncommit,
        oncancel: vi.fn(),
      },
    })
    flushSync()
    typeInto(target, 'caption', '')
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Update chart')!
      .click()
    flushSync()
    const spec = JSON.parse(oncommit.mock.calls[0][0] as string)
    expect('title' in spec).toBe(false)
    unmount(cmp)
    target.remove()
  })

  it('leaves a title the field cannot show as text untouched', () => {
    // An object title with styling is inert metadata readSpec preserved.
    // Clearing it because the text box showed nothing would be silent loss.
    const oncommit = vi.fn()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(ChartBuilder, {
      target,
      props: {
        initial: {
          mark: 'bar' as const,
          rows: [{ dose: 0, response: 1 }],
          x: { field: 'dose', type: 'quantitative' as const, title: '' },
          y: {
            field: 'response',
            type: 'quantitative' as const,
            title: '',
            aggregate: 'none' as const,
          },
          colour: null,
          extras: { title: { text: 42 } },
        },
        oncommit,
        oncancel: vi.fn(),
      },
    })
    flushSync()
    ;[...target.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Update chart')!
      .click()
    flushSync()
    const spec = JSON.parse(oncommit.mock.calls[0][0] as string)
    expect(spec.title).toEqual({ text: 42 })
    unmount(cmp)
    target.remove()
  })

  it('previews the caption below the chart, not inside it', () => {
    // Mirrors the document: the title is stripped from the embedded spec and
    // the caption is drawn as text beneath.
    const b = readyBuilder()
    typeInto(b.target, 'caption', 'Recovered sources')
    const lastSpec = JSON.parse(embedChart.mock.calls.at(-1)![1] as string)
    expect('title' in lastSpec).toBe(false)
    expect(b.target.querySelector('.chart-caption')?.textContent).toBe('Recovered sources')
    b.cleanup()
  })
})
```

The `embedChart` mock's declared type takes no arguments; widen it so `mock.calls.at(-1)![1]` type-checks. Change the `vi.hoisted` block near the top of the file (lines 20-24) to:

```ts
const { embedChart } = vi.hoisted(() => ({
  embedChart: vi.fn(
    (_el: HTMLElement, _specText: string): Promise<{ finalize: () => void } | null> =>
      Promise.resolve(null),
  ),
}))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `(cd frontend && npx vitest run src/ChartBuilder.test.ts)`
Expected: FAIL — `Cannot read properties of null` from `typeInto` (there is no `input[data-field="caption"]`).

- [ ] **Step 3: Write the implementation**

In `frontend/src/ChartBuilder.svelte`, add the import after line 5:

```ts
  import { captionFromTitle } from './lib/figures'
```

Add `caption: string` to the `Seed` interface (after `table: DataTable | null`):

```ts
    caption: string
```

Add to the object `seed` returns (beside `mark`):

```ts
      caption: captionFromTitle(initial?.extras.title),
```

Add the state beside the other encoding state (after line 135's `aggregate`):

```ts
  let caption = $state(seed.caption)
```

Add this just above `builderState` (before line 176):

```ts
  // The caption lives in the spec's own `title` — Vega-Lite's native home for
  // it, so the block stays portable and Pandoc keeps the caption. renderer.ts
  // lifts it out and draws it below the chart.
  //
  // Only rewritten when the field actually changed: a title the box cannot
  // show as text (an object with styling, say) is inert metadata readSpec
  // preserved, and clearing it because the box looked empty would be silent
  // data loss.
  const extras = $derived.by(() => {
    const base = { ...(initial?.extras ?? {}) }
    const text = caption.trim()
    if (text === seed.caption) return base
    if (text === '') delete base.title
    else base.title = text
    return base
  })
```

In `builderState`, replace the `extras:` line (line 187) with:

```ts
          extras,
```

and replace the comment above it with:

```ts
          // Metadata the UI never shows — a description, a $schema line — that
          // readSpec preserved when this chart was opened, plus the caption
          // the field above owns. Carrying the rest through is what stops
          // reopening a chart from quietly stripping it.
```

Add the preview spec just above `let previewEl` (before line 192):

```ts
  // The document draws the caption below the chart, so the preview must too —
  // otherwise the builder shows it inside the chart and the document shows it
  // underneath. No number is shown: numbering is a property of the document,
  // assigned by position, and the builder cannot know it.
  const previewSpec = $derived(
    builderState ? buildSpec({ ...builderState, extras: withoutTitle(extras) }) : '',
  )

  function withoutTitle(e: Record<string, unknown>): Record<string, unknown> {
    const rest = { ...e }
    delete rest.title
    return rest
  }
```

Replace the embed effect (lines 201-219) with:

```ts
  $effect(() => {
    const spec = previewSpec
    const el = previewEl
    if (spec === '' || !el) {
      generation++
      view?.finalize()
      view = null
      return
    }
    const gen = ++generation
    void embedChart(el, spec).then((v) => {
      if (gen !== generation) {
        v?.finalize()
        return
      }
      view?.finalize()
      view = v
    })
  })
```

Add the Caption field as the first child of `<section class="encode-step">` (immediately after line 271's opening tag, before the mark row):

```svelte
        <label class="caption-row">Caption
          <input data-field="caption" bind:value={caption} />
        </label>
```

Add the caption preview immediately after the `.chart-preview` div (after line 324):

```svelte
      {#if caption.trim()}
        <p class="chart-caption">{caption.trim()}</p>
      {/if}
```

In `frontend/public/style.css`, add beside the other `.chart-builder` rules (after the `.chart-preview` rule, line 277):

```css
/* A caption is a sentence, not a token, so it takes the full dialog width —
   unlike the axis controls, which line up in three columns. */
.encode-step .caption-row {
  grid-column: 1 / -1;
}

.chart-builder .chart-caption {
  margin-top: 8px;
  font-size: 0.9em;
  color: var(--muted-strong);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(cd frontend && npx vitest run && npm run check)`
Expected: PASS across the whole suite — including `ChartBuilder.test.ts`'s existing round-trip and teardown-leak tests, and `styleContract.test.ts` (the two new rules add no literal colours).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ChartBuilder.svelte frontend/src/ChartBuilder.test.ts frontend/public/style.css
git commit -m "feat: give the chart builder a caption field"
```

---

### Task 9: Changelog and manual verification

**Files:**
- Modify: `CHANGELOG.md` (the `## [Unreleased]` → `### Added` list)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run the full verification suite**

Run:

```bash
go test ./. && go build -o /dev/null . && (cd frontend && npx vitest run && npm run check)
```

Expected: all Go tests pass, the binary builds, every Vitest file passes, `svelte-check` reports no errors. Do not proceed on a failure — fix it first.

- [ ] **Step 2: Write the changelog entry**

Add to `CHANGELOG.md` under `## [Unreleased]` → `### Added`, after the existing chart-builder bullet:

```markdown
- Figures: captioned, numbered, and consistently placed. A caption is what
  makes a figure — give a chart a `title` (or use the builder's new Caption
  field) or an image some alt text, and it gains a numbered caption below it,
  counted in document order across charts and images together. A block with
  no caption renders exactly as before, and an image with empty alt stays
  decorative and unnumbered. Captions are written where each format already
  keeps them — a Vega-Lite `title`, an image's alt text — so a document
  converted through Pandoc keeps them.
- View → Figure Alignment (Left, Centre, Right) and View → Chart Width
  (Small, Medium, Large) place and size every figure in the document. A chart
  that sets its own `width` keeps it. An oversized chart scales down to the
  preview pane rather than scrolling it sideways, and a caption stays on the
  same page as its figure in an exported PDF.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: record figure presentation in the changelog"
```

- [ ] **Step 4: Manual check**

`npm run check` and Vitest cannot tell you whether centring and the widths actually *look* right — jsdom has no layout engine and reports every rect as zero. Run the app (`wails3 task run`, or the project's usual dev command) and walk this list:

1. A document with a captioned chart, a captioned image, and an uncaptioned chart: the first two read `Figure 1 — …` and `Figure 2 — …`, the third is untouched.
2. Insert a captioned figure above them; everything renumbers on the next keystroke.
3. Switch View → Figure Alignment through Left, Centre and Right; charts, images and captions all move.
4. Switch View → Chart Width through Small, Medium and Large; a chart with an explicit `"width"` does not move.
5. Narrow the preview pane until a large chart would overflow; it scales down rather than scrolling the pane sideways.
6. Export a PDF with a figure near a page boundary; the caption stays with it.
7. Create a chart in the builder with a caption; the builder preview shows it below the chart, not inside it. Insert it, then reopen it from Insert → Chart… — the Caption field is prefilled.
8. Scroll-sync check: turn on View → Sync Scrolling, put a tall captioned chart mid-document, and scroll the editor past it. The preview should track without jumping — the symptom of a duplicated anchor.
9. Switch to the dark theme with a captioned chart on screen: the chart keeps its light card, and the caption below it is readable.

Report anything that fails rather than fixing it silently — items 3-5 are layout judgements the design deliberately left to a human.

---

## Self-Review

**Spec coverage.** Every row of the design's Components table maps to a task: `figures.ts`/`figures.test.ts` → Tasks 1 and 3; `renderer.ts` → Tasks 2 and 3; `ChartBuilder.svelte` → Task 8; `style.css` → Tasks 7 and 8; `settings.go` → Task 4; `menu.go` → Task 5; `App.svelte` → Task 6. Every row of the "What becomes a figure", title-shape, and error-handling tables has a test in Task 3. The design's five testing bullets are Task 3's `numbering`, `what becomes one`, `title never renders twice` and `scroll-sync anchors` blocks; its "Go tests clamp the two new settings" is Task 4; its manual list is Task 9 step 4, extended with a scroll-sync and a dark-theme check.

**Two additions beyond the design, both deliberate.** The `p:has(> img:only-child)` selector, explained at the top of this plan. And `charts.ts`'s stale-anchor deletion in Task 3 — the design's "the attribute must not remain on the child" is defeated by the hydrator's cache without it, because stripping the title makes a captioned chart's `data-spec` byte-identical to the same chart uncaptioned, so one cache entry can serve both shapes.

**Naming consistency.** `chartWidthPx` is the function (Task 1) and `RenderEnv.chartWidthPx` the env field (Task 2); `chartWidth` is the `ChartWidth`-typed option and Svelte state (Tasks 2, 6). `figureAlign` is the Svelte prop and state; `figureAlignment` is the Go field and JSON key (Tasks 4, 6). `cssTextAlign` maps between them. `figureOf`/`FigureMeta`/`figurePlugin`/`figureLabel` are used exactly as defined in Tasks 1 and 3.
