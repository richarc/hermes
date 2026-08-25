# Preview and PDF Styling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the preview render the document as a page — a white sheet on a
desk, serif body, true paper geometry — so the exported PDF is the same
rendering rather than a patched one.

**Architecture:** The palette splits into theme-varying *chrome* tokens
(`:root` / `:root[data-theme="dark"]`) and invariant light *document* tokens
(`--doc-*`, declared once on `.sheet`). `Preview.svelte` gains a `.sheet`
wrapper inside the existing `.preview-pane` scroller; the sheet's width and
margin come from a new `lib/paper.ts` as inline custom properties, driven by a
new `PaperSize` setting crossed with the existing `PrintOrientation`. Because
the document region is now always light, the fifty-line `@media print` palette
override and the dark-mode figure-card tokens are deleted rather than
maintained. Export leaves the print panel for a fixed-`NSPrintInfo`
`NSPrintSaveJob`.

**Tech Stack:** Svelte 5 + TypeScript + Vite, Vitest, plain CSS custom
properties, Go 1.x with cgo/AppKit, Wails v3 beta.12, Task.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-25-preview-and-pdf-styling-design.md`.
- Wails v3 pinned at `v3.0.0-beta.12` across `go.mod`, the `wails3` CLI and
  `@wailsio/runtime`. Do not bump.
- **No literal colours in a CSS rule body.** `styleContract.test.ts` fails the
  build on `#rgb`, `rgba(…)` or a CSS named colour outside a custom-property
  declaration. This includes `box-shadow`.
- **Never write `centre` in a CSS rule.** Hermes' spelling is `centre`; CSS's
  keyword is `center`; `cssTextAlign` in `lib/figures.ts` is the only mapping
  point. Comments may use either.
- Go tests and build: `go test ./. && go build -o /dev/null .` — `.`, never
  `./...`.
- Frontend tests: `cd frontend && npx vitest run <path>`.
- Never hand-edit `frontend/bindings/**`. Regenerate with
  `wails3 task common:generate:bindings`.
- Page margin is **25mm**, one value, used by the sheet's percentage padding
  and by `@page`. The previous value was 20mm; this deliberately changes
  existing PDF output.
- Body type is **11pt / 1.5** on screen and in print — one value, no
  divergence.
- Commit after every task.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `frontend/public/style.css` | The single place a colour is decided; chrome palette, document palette, sheet layout, print rules | Modify |
| `frontend/src/lib/styleContract.test.ts` | Enforces the palette contract | Modify |
| `frontend/src/lib/contrast.test.ts` | Enforces WCAG ratios per palette | Modify |
| `frontend/src/lib/paper.ts` | Paper vocabulary: sizes, orientation, the 25mm margin, and the derived sheet width and margin percentage | **Create** |
| `frontend/src/lib/paper.test.ts` | Tests for the above | **Create** |
| `frontend/src/Preview.svelte` | Preview pane; gains the `.sheet` wrapper and the two-ref split | Modify |
| `frontend/src/Preview.test.ts` | Preview component tests | Modify |
| `frontend/src/App.svelte` | Reads settings, passes paper props to `Preview` | Modify |
| `settings.go` | The `Settings` struct, defaults, `normalise` | Modify |
| `settings_test.go` | Settings tests | Modify |
| `menu.go` | Paper Size submenu; File → Print… | Modify |
| `documentservice.go` | `ExportPDF` (save dialog) and `PrintDocument` | Modify |
| `print_darwin.go` | cgo print/export operations | Modify |
| `print_test.go` | Pure helpers from the print path | **Create** |

`lib/paper.ts` is a new file rather than an addition to `lib/figures.ts`
because `figures.ts` owns *figure* vocabulary (`ChartWidth`,
`FigureAlignment`, `cssTextAlign`) and paper geometry is a different subject
with its own consumers.

---

### Task 1: Split the palette into chrome and document tokens

The largest task and the one everything else rests on. It is one task because
a half-applied rename does not compile into anything testable: the rules and
the contract test have to move together.

**Files:**
- Modify: `frontend/public/style.css`
- Modify: `frontend/src/lib/styleContract.test.ts`
- Modify: `frontend/src/lib/contrast.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `--doc-*` token set, declared on `.sheet`, and a `.sheet`
  selector that Task 2 will create an element for. Names produced:
  `--doc-bg`, `--doc-fg`, `--doc-muted`, `--doc-border`, `--doc-link`,
  `--doc-surface-code-block`, `--doc-surface-code-inline`,
  `--doc-font-body`, `--doc-font-mono`, `--doc-syn-keyword`,
  `--doc-syn-string`, `--doc-syn-number`, `--doc-syn-type`,
  `--doc-syn-function`, `--doc-syn-meta`, `--doc-syn-link`. Chrome gains
  `--desk` and `--sheet-shadow`.

- [ ] **Step 1: Write the failing contract tests**

Replace the whole `describe('dark palette', …)` block in
`frontend/src/lib/styleContract.test.ts` with this. The two print-palette
tests are deleted, not adapted — the print block no longer declares palette
variables at all.

```ts
describe('dark palette', () => {
  it('overrides exactly the chrome variables the light palette defines', () => {
    const light = blockNames(CSS, ':root')
    const dark = blockNames(CSS, ':root[data-theme="dark"]')
    // A name defined light-only is a rule that stays light in dark mode —
    // the single most likely way this feature ships half-finished.
    expect([...light].sort()).toEqual([...dark].sort())
  })

  it('declares no document tokens in a theme block', () => {
    // The sheet is white in dark mode, so the document palette is invariant.
    // A --doc-* name appearing under a theme selector is that invariant
    // quietly broken, and it would look correct in whichever theme the
    // author happened to have open.
    expect(blockNames(CSS, ':root').filter((n) => n.startsWith('--doc-'))).toEqual([])
    expect(
      blockNames(CSS, ':root[data-theme="dark"]').filter((n) => n.startsWith('--doc-')),
    ).toEqual([])
  })

  it('declares no palette variables at all inside @media print', () => {
    // Print used to re-light a dark document; the document is now always
    // light, so there is nothing to re-light. A palette declaration
    // reappearing here means someone reintroduced a second source of truth
    // for the document's colours.
    const print = CSS.slice(CSS.indexOf('@media print'))
    expect(print.match(/^\s*--[a-z0-9-]+\s*:/gm) ?? []).toEqual([])
  })

  it('declares every document token exactly once', () => {
    const doc = [...CSS.matchAll(/^\s*(--doc-[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
    expect([...new Set(doc)].sort()).toEqual([...doc].sort())
  })
})
```

Then, in the same file, update the `code token styling` block — the preview's
token rules now live under `.sheet` and read `--doc-syn-*`:

```ts
    for (const role of CODE_TOKENS) {
      const variable = role.palette ?? role.name
      const re = new RegExp(
        `\\.sheet\\s+\\.tok-${role.name}\\s*\\{[^}]*color:\\s*var\\(--doc-syn-${variable}\\)`,
      )
      expect(CSS, `no sheet rule for tok-${role.name}`).toMatch(re)
    }
```

- [ ] **Step 2: Write the failing contrast test**

In `frontend/src/lib/contrast.test.ts`, add the document pairs and a test for
them, after the existing `PAIRS` array:

```ts
/** The document palette is one invariant light set, so it is one list. */
const DOC_PAIRS: Array<[label: string, fg: string, bg: string, target: number]> = [
  ['document text', '--doc-fg', '--doc-bg', 7],
  ['document muted', '--doc-muted', '--doc-bg', 4.5],
  ['document link', '--doc-link', '--doc-bg', 4.5],
  ['doc syntax keyword', '--doc-syn-keyword', '--doc-bg', 4.5],
  ['doc syntax string', '--doc-syn-string', '--doc-bg', 4.5],
  ['doc syntax number', '--doc-syn-number', '--doc-bg', 4.5],
  ['doc syntax type', '--doc-syn-type', '--doc-bg', 4.5],
  ['doc syntax function', '--doc-syn-function', '--doc-bg', 4.5],
  ['doc syntax meta', '--doc-syn-meta', '--doc-bg', 4.5],
  ['doc syntax link', '--doc-syn-link', '--doc-bg', 4.5],
]
```

And add this test inside `describe('palette contrast', …)`:

```ts
  it('meets every target in the document palette', () => {
    // The print palette was never contrast-checked, on the reasoning that a
    // separate set would be numbers nothing verifies. With one invariant
    // document palette that reasoning no longer applies — this set is what
    // both the screen and the PDF actually use.
    const p = palette('.sheet')
    const failures: string[] = []
    for (const [label, fgVar, bgVar, target] of DOC_PAIRS) {
      const ratio = contrast(p[fgVar], p[bgVar])
      if (ratio < target) {
        failures.push(`${label}: ${ratio.toFixed(2)}:1 (needs ${target}:1)`)
      }
    }
    expect(failures).toEqual([])
  })
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/styleContract.test.ts src/lib/contrast.test.ts`

Expected: FAIL. `contrast.test.ts` throws `no block for .sheet` from
`palette()`. `styleContract.test.ts` fails `declares no palette variables at
all inside @media print` (the print block still declares ~45 of them) and the
`code token styling` assertions (`no sheet rule for tok-keyword`).

- [ ] **Step 4: Add the two new chrome tokens**

In `frontend/public/style.css`, inside `:root`, after the `--divider` line:

```css
  /* The ground the sheet sits on. Distinct from --bg because in light mode
     --bg is nearly white and the sheet would have no edge against it. */
  --desk: #e4e4e4;
  --sheet-shadow: rgba(0, 0, 0, 0.14);
```

And the matching pair inside `:root[data-theme="dark"]`, in the same position:

```css
  --desk: #161616;
  --sheet-shadow: rgba(0, 0, 0, 0.5);
```

- [ ] **Step 5: Delete the three figure-card tokens**

Remove these three lines and their comment from `:root`:

```css
  /* Figures are cards only in dark mode; light keeps today's layout exactly. */
  --figure-bg: transparent;
  --figure-pad: 0;
  --figure-radius: 0;
```

Remove the same three names from `:root[data-theme="dark"]`.

- [ ] **Step 6: Add the document palette block**

Add this immediately after the closing brace of `:root[data-theme="dark"]`,
so all three palettes sit together at the top of the file. It must come before
any `.sheet` layout rule, because `contrast.test.ts`'s `palette('.sheet')`
reads the *first* `.sheet {` block in the file.

```css
/* The document palette. Declared once, light, and deliberately outside every
   theme selector: the sheet is white in dark mode, so a paper's colours do
   not vary at all. That invariance is what lets @media print declare no
   palette of its own — there is nothing left to re-light.
   Named --doc-* rather than reusing --fg and friends so that a rule under the
   sheet says at the point of use which of the two palettes it means.
   Enforced by styleContract.test.ts and measured by contrast.test.ts. */
.sheet {
  --doc-bg: #ffffff;
  --doc-fg: #000000;
  --doc-muted: #555555;
  --doc-border: #cccccc;
  --doc-link: #0b62d6;
  --doc-surface-code-block: #f6f6f6;
  --doc-surface-code-inline: #f2f2f2;

  /* ui-serif resolves to New York on macOS: a text face Apple designed for
     screen and print, so it costs nothing to bundle and pairs with the SF
     chrome around it. One token, so swapping in a bundled academic serif
     later is this line rather than a refactor. */
  --doc-font-body: ui-serif, 'New York', Georgia, serif;
  --doc-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Code tokens on paper. These were previously the --syn-* set shared with
     the editor; they are duplicated rather than shared because the editor's
     ground follows the theme and the sheet's never does. */
  --doc-syn-keyword: #7b2d8e;
  --doc-syn-string: #1a6b3a;
  --doc-syn-number: #9a4a00;
  --doc-syn-type: #0d6b6b;
  --doc-syn-function: #1a4fa0;
  --doc-syn-meta: #6b6b6b;
  --doc-syn-link: #0b62d6;
}
```

- [ ] **Step 7: Repoint every preview rule at the document palette**

In `frontend/public/style.css`, replace the whole run of rules from
`/* Document typography …` down to and including the
`.preview-pane a { color: var(--link); }` line with the block below. Selectors
move from `.preview-pane` to `.sheet`; colours move to `--doc-*`. The
figure-card rule is deleted outright.

```css
/* Document typography — the global reset strips default margins, so the
   rendered markdown gets its spacing back here. These are the sheet's rules,
   not the pane's: everything here describes a page, and reads the invariant
   document palette rather than the theme. */
.sheet p,
.sheet ul,
.sheet ol,
.sheet blockquote,
.sheet pre,
.sheet table,
.sheet .katex-display { margin-bottom: 0.9em; }
.sheet h1, .sheet h2, .sheet h3,
.sheet h4, .sheet h5, .sheet h6 {
  margin: 1.3em 0 0.5em; line-height: 1.25; font-weight: 600;
}
.sheet h1 { font-size: 1.75em; }
.sheet h2 { font-size: 1.45em; }
.sheet h3 { font-size: 1.2em; }
.sheet h4, .sheet h5, .sheet h6 { font-size: 1em; }
.sheet > h1:first-child, .sheet > h2:first-child { margin-top: 0; }
.sheet ul, .sheet ol { padding-left: 1.7em; }
.sheet li { margin: 0.25em 0; }
.sheet li > ul, .sheet li > ol { margin-bottom: 0; }
.sheet blockquote {
  padding-left: 1em; border-left: 3px solid var(--doc-border); color: var(--doc-muted);
}
.sheet pre {
  background: var(--doc-surface-code-block); padding: 12px; border-radius: 6px; overflow-x: auto;
}
.sheet code {
  font-family: var(--doc-font-mono); font-size: 0.9em;
}
.sheet :not(pre) > code {
  background: var(--doc-surface-code-inline); padding: 0.1em 0.3em; border-radius: 4px;
}
/* Code tokens on the sheet. The class names come from lib/syntaxTags.ts, the
   same list the editor's HighlightStyle derives from, so a role cannot exist
   in one pane and not the other. The colours differ deliberately: the editor
   sits on a themed ground, the sheet on paper. */
.sheet .tok-keyword { color: var(--doc-syn-keyword); }
.sheet .tok-string { color: var(--doc-syn-string); }
.sheet .tok-number { color: var(--doc-syn-number); }
.sheet .tok-type { color: var(--doc-syn-type); }
.sheet .tok-function { color: var(--doc-syn-function); }
.sheet .tok-comment { color: var(--doc-syn-meta); }
.sheet .tok-link { color: var(--doc-syn-link); }
.sheet table { border-collapse: collapse; }
.sheet th, .sheet td { border: 1px solid var(--doc-border); padding: 6px 10px; }
.sheet hr { border: 0; border-top: 1px solid var(--doc-border); margin: 1.5em 0; }
.sheet img { max-width: 100%; }
.sheet a { color: var(--doc-link); }
```

Note what is *gone*: the `.preview-pane .mermaid-diagram, .preview-pane
.vega-lite-chart, .preview-pane img { background: var(--figure-bg); … }` rule
and its comment. A transparent-background figure needed a light mount only
because the ground could be dark. It cannot be, now.

- [ ] **Step 8: Repoint the remaining sheet-scoped rules**

Further down, change the figure and chart-scaling rules from `.preview-pane`
to `.sheet`:

```css
.sheet figure { margin-bottom: 0.9em; }
.sheet figcaption {
  margin-top: 0.5em;
  font-size: 0.9em;
  color: var(--doc-muted);
}

.sheet .vega-lite-chart svg, .sheet .mermaid-diagram svg { max-width: 100%; height: auto; }
```

**Leave the three `[data-figure-align]` blocks completely alone**, along with
the long comment above them. The attribute stays on `.preview-pane`, and
`.preview-pane[data-figure-align="left"] figure` goes on matching a figure
inside the sheet through the descendant combinator — inserting `.sheet` into
those fifteen selectors would be churn that changes nothing. Task 3 adds a
test pinning the attribute to the pane so this stays true.

- [ ] **Step 9: Delete the print palette override**

In `@media print`, delete the entire `:root, :root[data-theme="dark"] { … }`
block — all of it, including its opening comment about re-lighting a dark
export, which no longer describes anything. Leave the rest of the print block
alone for now; Task 5 finishes it.

- [ ] **Step 10: Run the tests**

Run: `cd frontend && npx vitest run src/lib/styleContract.test.ts src/lib/contrast.test.ts`
Expected: PASS.

Then run the whole frontend suite, because `.preview-pane` appeared in other
tests' expectations:

Run: `cd frontend && npx vitest run`
Expected: PASS. If a test asserts on a `.preview-pane` descendant selector,
update it to `.sheet` — the element does not exist yet, which is Task 2, so a
*rendering* test that queries `.sheet` will still fail here. Only fix
stylesheet-string assertions in this task.

- [ ] **Step 11: Commit**

```bash
git add frontend/public/style.css frontend/src/lib/styleContract.test.ts frontend/src/lib/contrast.test.ts
git commit -m "refactor: split the palette into chrome and document tokens

The sheet is white in dark mode, so a document's colours do not vary. That
makes one palette two: theme-varying chrome, and an invariant light --doc-*
set the sheet declares once. The fifty-line print palette override existed
only to re-light a dark document and is deleted, as are the three figure-card
tokens that mounted transparent figures against a dark ground.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The paper vocabulary

**Files:**
- Create: `frontend/src/lib/paper.ts`
- Create: `frontend/src/lib/paper.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type PaperSize = 'a4' | 'letter'`,
  `type PageOrientation = 'portrait' | 'landscape'`,
  `PAGE_MARGIN_MM: 25`,
  `sheetWidthMm(size: PaperSize, orientation: PageOrientation): number`,
  `sheetMarginPercent(size: PaperSize, orientation: PageOrientation): number`,
  `sheetStyle(size: PaperSize, orientation: PageOrientation): string`,
  `DEFAULT_PAPER_SIZE: PaperSize`, `DEFAULT_ORIENTATION: PageOrientation`.
  Task 3 sets `sheetStyle`'s result as the sheet's inline `style`; Task 4
  reads the type names.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/paper.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  PAGE_MARGIN_MM,
  sheetWidthMm,
  sheetMarginPercent,
  sheetStyle,
  DEFAULT_PAPER_SIZE,
  DEFAULT_ORIENTATION,
} from './paper'

describe('sheetWidthMm', () => {
  it('gives the short edge in portrait and the long edge in landscape', () => {
    expect(sheetWidthMm('a4', 'portrait')).toBe(210)
    expect(sheetWidthMm('a4', 'landscape')).toBe(297)
    expect(sheetWidthMm('letter', 'portrait')).toBe(216)
    expect(sheetWidthMm('letter', 'landscape')).toBe(279)
  })
})

describe('sheetMarginPercent', () => {
  // The margin is a percentage rather than a length so it stays
  // proportionally true when a narrow pane shrinks the sheet below true
  // size. Percentage padding resolves against width, so each paper and
  // orientation needs its own value: one fixed percentage would draw 25mm on
  // A4 portrait and 35mm on A4 landscape while @page printed 25mm for both.
  it('is 25mm expressed against each sheet width', () => {
    expect(sheetMarginPercent('a4', 'portrait')).toBeCloseTo(11.9, 2)
    expect(sheetMarginPercent('a4', 'landscape')).toBeCloseTo(8.42, 2)
    expect(sheetMarginPercent('letter', 'portrait')).toBeCloseTo(11.57, 2)
    expect(sheetMarginPercent('letter', 'landscape')).toBeCloseTo(8.96, 2)
  })

  it('always resolves back to the one page margin', () => {
    // The property this file exists to guarantee: whatever the paper, the
    // percentage times the width is 25mm, so the sheet and @page agree.
    for (const size of ['a4', 'letter'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const mm = (sheetMarginPercent(size, orientation) / 100) * sheetWidthMm(size, orientation)
        expect(mm).toBeCloseTo(PAGE_MARGIN_MM, 4)
      }
    }
  })
})

describe('sheetStyle', () => {
  // The formatting boundary. sheetMarginPercent is exact (25/210*100 is
  // 11.904761904761905), which is what the identity test above needs, but
  // interpolating that straight into a style attribute writes all seventeen
  // digits. Rounding lives here rather than in the percentage itself so the
  // exact value stays available to the assertion that it resolves to 25mm.
  it('writes both custom properties, rounded to three decimals', () => {
    expect(sheetStyle('a4', 'portrait')).toBe('--sheet-width: 210mm; --sheet-margin: 11.905%')
    expect(sheetStyle('a4', 'landscape')).toBe('--sheet-width: 297mm; --sheet-margin: 8.418%')
    expect(sheetStyle('letter', 'portrait')).toBe('--sheet-width: 216mm; --sheet-margin: 11.574%')
    expect(sheetStyle('letter', 'landscape')).toBe('--sheet-width: 279mm; --sheet-margin: 8.961%')
  })
})

describe('defaults', () => {
  it('matches the Go defaults in settings.go', () => {
    expect(DEFAULT_PAPER_SIZE).toBe('a4')
    expect(DEFAULT_ORIENTATION).toBe('portrait')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/lib/paper.test.ts`
Expected: FAIL — `Failed to resolve import "./paper"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/paper.ts`:

```ts
/**
 * Paper geometry, in one place.
 *
 * The preview draws the document as a sheet at true paper proportions, so the
 * app has to know what paper it is. These values are also what the PDF export
 * builds its NSPrintInfo from, which is the point: one source of truth means
 * the sheet cannot promise a measure the export does not deliver.
 */

export type PaperSize = 'a4' | 'letter'
export type PageOrientation = 'portrait' | 'landscape'

/** Must match settings.go's defaultSettings(). */
export const DEFAULT_PAPER_SIZE: PaperSize = 'a4'
export const DEFAULT_ORIENTATION: PageOrientation = 'portrait'

/**
 * The page margin, used by the sheet's padding and by @page alike. Changed
 * from 20mm in v0.8: A4 at 20mm gives an ~88-character measure, which is
 * poor. 25mm gives ~82 — still wide, because that is what a one-column A4
 * paper genuinely is.
 */
export const PAGE_MARGIN_MM = 25

/** Short and long edge in millimetres. */
const PAPER_MM: Record<PaperSize, { short: number; long: number }> = {
  a4: { short: 210, long: 297 },
  letter: { short: 216, long: 279 },
}

export function sheetWidthMm(size: PaperSize, orientation: PageOrientation): number {
  const paper = PAPER_MM[size] ?? PAPER_MM[DEFAULT_PAPER_SIZE]
  return orientation === 'landscape' ? paper.long : paper.short
}

/**
 * The page margin as a percentage of the sheet's width.
 *
 * A percentage rather than a length because percentage padding resolves
 * against width, so the margin stays proportionally correct when a narrow
 * preview pane shrinks the sheet below true paper size. It follows that the
 * value is per paper AND per orientation — a single fixed percentage would
 * draw 25mm on A4 portrait and 35mm on A4 landscape while @page printed 25mm
 * for both, so the sheet would lie for three of the four combinations.
 */
export function sheetMarginPercent(size: PaperSize, orientation: PageOrientation): number {
  return (PAGE_MARGIN_MM / sheetWidthMm(size, orientation)) * 100
}

/**
 * The sheet's geometry as an inline style, which is how it reaches CSS.
 *
 * Rounding happens here rather than in sheetMarginPercent so that the exact
 * value stays available to the test asserting the margin resolves back to
 * 25mm; three decimals is well below a device pixel at any sheet size.
 */
export function sheetStyle(size: PaperSize, orientation: PageOrientation): string {
  const margin = sheetMarginPercent(size, orientation).toFixed(3).replace(/\.?0+$/, '')
  return `--sheet-width: ${sheetWidthMm(size, orientation)}mm; --sheet-margin: ${margin}%`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/lib/paper.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/paper.ts frontend/src/lib/paper.test.ts
git commit -m "feat: add the paper vocabulary

Sheet width and the 25mm page margin, with the margin expressed as a
percentage of width so it stays proportionally true when a narrow pane
shrinks the sheet. The percentage is therefore per paper and per orientation;
a test asserts all four resolve back to the same 25mm.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The sheet element

**Files:**
- Modify: `frontend/src/Preview.svelte`
- Modify: `frontend/src/Preview.test.ts`
- Modify: `frontend/public/style.css`

**Interfaces:**
- Consumes: `PaperSize`, `PageOrientation`, `sheetStyle`,
  `DEFAULT_PAPER_SIZE`, `DEFAULT_ORIENTATION` from `lib/paper.ts` (Task 2);
  the `.sheet` palette block from Task 1.
- Produces: `Preview` accepts two new props, `paperSize?: PaperSize` and
  `orientation?: PageOrientation`. Task 4 passes them from `App.svelte`.

**The critical detail:** `collectAnchors` measures with
`getBoundingClientRect` deltas against the container it is given **plus that
container's `scrollTop`**, so it must keep receiving `.preview-pane` — the
element that scrolls. Only `innerHTML` and the three hydrators move to the
sheet. Passing the sheet instead would offset every anchor by the sheet's top
margin, and the sheet does not scroll, so its `scrollTop` of 0 would not
correct it.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/Preview.test.ts`:

```ts
  it('renders the markdown into a sheet inside the scrolling pane', () => {
    const { container } = render(Preview, { props: { html: '<p>hello</p>' } })
    const pane = container.querySelector('.preview-pane')!
    const sheet = pane.querySelector('.sheet')!
    expect(sheet).not.toBeNull()
    expect(sheet.innerHTML).toBe('<p>hello</p>')
    // The pane is the scroller and must stay empty of document content of its
    // own, so scroll offsets keep meaning what scrollSync assumes.
    expect(pane.firstElementChild).toBe(sheet)
  })

  it('sizes the sheet from the paper and orientation', () => {
    const { container } = render(Preview, {
      props: { html: '', paperSize: 'a4', orientation: 'portrait' },
    })
    const sheet = container.querySelector('.sheet') as HTMLElement
    expect(sheet.style.getPropertyValue('--sheet-width')).toBe('210mm')
    expect(sheet.style.getPropertyValue('--sheet-margin')).toBe('11.905%')
  })

  it('resizes the sheet for landscape', () => {
    const { container } = render(Preview, {
      props: { html: '', paperSize: 'a4', orientation: 'landscape' },
    })
    const sheet = container.querySelector('.sheet') as HTMLElement
    expect(sheet.style.getPropertyValue('--sheet-width')).toBe('297mm')
    // Not the portrait percentage: a fixed one would print 25mm and draw 35mm.
    expect(sheet.style.getPropertyValue('--sheet-margin')).toBe('8.418%')
  })

  it('keeps the alignment attribute on the pane, not the sheet', () => {
    // style.css matches .preview-pane[data-figure-align="…"] .sheet figure.
    // Moving the attribute would silently stop all three alignments working.
    const { container } = render(Preview, { props: { html: '', figureAlign: 'centre' } })
    expect(container.querySelector('.preview-pane')!.getAttribute('data-figure-align')).toBe('center')
    expect(container.querySelector('.sheet')!.hasAttribute('data-figure-align')).toBe(false)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/Preview.test.ts`
Expected: FAIL — `sheet` is null, because `.sheet` does not exist yet.

- [ ] **Step 3: Add the sheet to the component**

In `frontend/src/Preview.svelte`, add the import:

```ts
  import {
    sheetStyle,
    DEFAULT_PAPER_SIZE,
    DEFAULT_ORIENTATION,
    type PaperSize,
    type PageOrientation,
  } from './lib/paper'
```

Add the two props to the `$props()` destructuring and its type:

```ts
    paperSize = DEFAULT_PAPER_SIZE,
    orientation = DEFAULT_ORIENTATION,
```

```ts
    paperSize?: PaperSize
    orientation?: PageOrientation
```

Add the second ref beside `let container: HTMLElement`:

```ts
  // Two refs, deliberately. `container` is the scroller: it owns scrollTop,
  // the ResizeObserver, and the anchor measurements. `sheet` is the paper:
  // it owns the rendered document. collectAnchors measures rects against the
  // container it is given PLUS that container's scrollTop, so handing it the
  // sheet — which never scrolls — would offset every anchor by the sheet's
  // top margin with nothing to correct it.
  let sheet: HTMLElement
```

Change the `$effect` body's first line and all three hydrator calls from
`container` to `sheet`:

```ts
  $effect(() => {
    sheet.innerHTML = html
    sync.invalidate()
    void hydrator.hydrate(sheet).then(() => sync.invalidate())
    void mermaidHydrator.hydrate(sheet).then(() => sync.invalidate())
    void codeHydrator.hydrate(sheet).catch(() => {})
  })
```

Leave `createScrollSync`'s `getAnchors`, `getScrollHeight` and `setScrollTop`
pointing at `container`. Leave the `ResizeObserver` observing `container`.

Replace the markup at the bottom of the file:

```svelte
<div
  class="preview-pane"
  data-figure-align={cssTextAlign(figureAlign)}
  bind:this={container}
  onclick={onPreviewClick}
>
  <div
    class="sheet"
    bind:this={sheet}
    style={sheetStyle(paperSize, orientation)}
  ></div>
</div>
```

- [ ] **Step 4: Add the sheet's layout rules**

In `frontend/public/style.css`, replace the `.preview-pane` rule and add the
sheet layout immediately after it. This `.sheet` block must come *after* the
document palette block added in Task 1, so `contrast.test.ts` still finds the
palette first.

```css
.preview-pane { flex: 1; overflow: auto; padding: 24px 0; background: var(--desk); }

/* The sheet: the document drawn at true paper proportions.

   `min(…, 100%)` rather than a fixed width because A4 is about 794px and a
   split view on a 1440px window leaves the pane around 720px — so the sheet
   often cannot be true size. It shrinks rather than clipping: text stays
   crisp and the proportions stay right, but the absolute measure is only
   true when the pane is wide enough. transform: scale() would keep true size
   and is the obvious alternative; it blurs text, and it breaks the
   getBoundingClientRect arithmetic scrollSync.ts depends on.

   The margin is a percentage — see lib/paper.ts. Percentage padding resolves
   against width, so a shrunk sheet keeps a proportionally correct margin. */
.sheet {
  width: min(var(--sheet-width), 100%);
  margin: 0 auto;
  padding: var(--sheet-margin);
  background: var(--doc-bg);
  color: var(--doc-fg);
  font-family: var(--doc-font-body);
  font-size: 11pt;
  line-height: 1.5;
  box-shadow: 0 1px 3px var(--sheet-shadow);
}
```

Note the `line-height: 1.6` that was on `.preview-pane` is gone: 1.5 is the
one value, matching print.

- [ ] **Step 5: Run the Preview tests**

Run: `cd frontend && npx vitest run src/Preview.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `cd frontend && npx vitest run`
Expected: PASS. Scroll-sync tests are the ones to watch: if any fail, the
likely cause is a hydrator or `collectAnchors` call pointed at the wrong ref.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/Preview.svelte frontend/src/Preview.test.ts frontend/public/style.css
git commit -m "feat: render the document on a sheet

The preview pane becomes the desk and a new .sheet inside it becomes the
paper, sized from lib/paper.ts at true proportions. Two refs, not one: the
pane keeps scrollTop, the ResizeObserver and the anchor measurements, because
collectAnchors measures against the container's scrollTop and the sheet does
not scroll.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The paper size setting

**Files:**
- Modify: `settings.go:15-55`
- Modify: `settings_test.go`
- Modify: `menu.go:68-91`
- Modify: `frontend/src/App.svelte`
- Regenerate: `frontend/bindings/hermes/models.ts`

**Interfaces:**
- Consumes: `Preview`'s `paperSize` / `orientation` props (Task 3).
- Produces: `Settings.PaperSize` (`json:"paperSize"`), legal values `"a4"` and
  `"letter"`, default `"a4"`.

- [ ] **Step 1: Write the failing Go tests**

Add to `settings_test.go`:

```go
func TestPaperSizeDefaultsToA4(t *testing.T) {
	if got := defaultSettings().PaperSize; got != "a4" {
		t.Fatalf("PaperSize = %q, want %q", got, "a4")
	}
}

func TestPaperSizeNormalisesUnknownValues(t *testing.T) {
	// A hand-edited settings file, or a stale binding call, must not leave the
	// app holding a paper it cannot draw.
	got := Settings{PaperSize: "foolscap"}.normalise().PaperSize
	if got != "a4" {
		t.Fatalf("PaperSize = %q, want %q", got, "a4")
	}
	if got := (Settings{PaperSize: "letter"}).normalise().PaperSize; got != "letter" {
		t.Fatalf("PaperSize = %q, want %q", got, "letter")
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./. -run TestPaperSize`
Expected: FAIL to compile — `unknown field PaperSize in struct literal`.

- [ ] **Step 3: Add the field, default and clamp**

In `settings.go`, add to the `Settings` struct after `ChartWidth`:

```go
	PaperSize        string `json:"paperSize"`
```

Add to `defaultSettings()`:

```go
		PaperSize:        "a4",
```

Add to `normalise()`:

```go
	if s.PaperSize != "a4" && s.PaperSize != "letter" {
		s.PaperSize = defaultSettings().PaperSize
	}
```

- [ ] **Step 4: Run the Go tests**

Run: `go test ./. && go build -o /dev/null .`
Expected: PASS.

- [ ] **Step 5: Add the Paper Size menu**

In `menu.go`, immediately before the existing `orientation := file.AddSubmenu("PDF Orientation")`
line, add a matching submenu. It follows the same read-modify-write pattern,
for the same reason: this menu only ever changes the one field it owns.

```go
	paper := file.AddSubmenu("Paper Size")
	papers := []struct {
		label string
		value string
	}{
		{"A4", "a4"},
		{"US Letter", "letter"},
	}
	for _, p := range papers {
		value := p.value
		paper.AddRadio(p.label, docs.Settings().PaperSize == value).OnClick(func(*application.Context) {
			next := docs.Settings()
			next.PaperSize = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save paper size: %v", err)
			}
		})
	}
```

- [ ] **Step 6: Regenerate the bindings**

Run: `wails3 task common:generate:bindings`
Expected: `frontend/bindings/hermes/models.ts` gains `"paperSize": string;` in
the `Settings` interface. Do not hand-edit it.

- [ ] **Step 7: Pass the settings through App.svelte**

In `frontend/src/App.svelte`, add the import:

```ts
  import {
    DEFAULT_PAPER_SIZE,
    DEFAULT_ORIENTATION,
    type PaperSize,
    type PageOrientation,
  } from './lib/paper'
```

Add the state, beside `let figureAlign = $state<FigureAlignment>('centre')`:

```ts
  let paperSize = $state<PaperSize>(DEFAULT_PAPER_SIZE)
  let orientation = $state<PageOrientation>(DEFAULT_ORIENTATION)
```

In `refreshSettings()`, beside the existing assignments:

```ts
    paperSize = s.paperSize as PaperSize
    orientation = s.printOrientation as PageOrientation
```

And pass them to the component:

```svelte
    <Preview bind:this={preview} {html} {figureAlign} {paperSize} {orientation} />
```

- [ ] **Step 8: Verify end to end**

Run: `go test ./. && go build -o /dev/null . && cd frontend && npx vitest run`
Expected: PASS.

Then build and launch — **`run` does not build**, so both, in order:

Run: `wails3 task build && wails3 task run`

Check: File → Paper Size → US Letter visibly widens the sheet; File → PDF
Orientation → Landscape widens it further and *narrows* the margin
proportionally. Both survive a restart.

- [ ] **Step 9: Commit**

```bash
git add settings.go settings_test.go menu.go frontend/src/App.svelte frontend/bindings
git commit -m "feat: add a paper size setting

The sheet has to know what paper it is to be drawn at true proportions, so
paper size joins orientation in Settings and gets a File menu of its own.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Reduce the print block to what is genuinely print-specific

**Files:**
- Modify: `frontend/public/style.css` (the `@media print` block)
- Modify: `frontend/src/lib/styleContract.test.ts`

**Interfaces:**
- Consumes: `.sheet` (Task 3), the 25mm margin (Task 2).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/lib/styleContract.test.ts`, inside `describe('dark palette', …)`
or a new `describe('print', …)` block:

```ts
describe('print', () => {
  const print = CSS.slice(CSS.indexOf('@media print'))

  it('flattens the sheet so the page margin is not applied twice', () => {
    // @page supplies the paper margin when printing. A sheet that kept its
    // percentage padding would add a second one inside it, and every export
    // would come out with margins roughly double what the screen promised.
    expect(print).toMatch(/\.sheet[^{]*\{[^}]*padding: 0/)
    expect(print).toMatch(/\.sheet[^{]*\{[^}]*width: auto/)
  })

  it('drops the sheet shadow, which is chrome rather than document', () => {
    expect(print).toMatch(/\.sheet[^{]*\{[^}]*box-shadow: none/)
  })

  it('uses the same page margin the sheet draws', () => {
    expect(print).toMatch(/@page\s*\{[^}]*margin: 25mm/)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/lib/styleContract.test.ts`
Expected: FAIL — no `.sheet` rule in the print block, and `@page` still says
`2cm`.

- [ ] **Step 3: Rewrite the print block**

Replace everything inside `@media print { … }` (the palette override is
already gone from Task 1) with:

```css
@media print {
  /* What is left here is only what is genuinely print-specific. The document
     palette does not appear: the sheet is invariant light on screen already,
     so there is nothing to re-light — which is the whole reason this block
     used to be fifty lines longer. */
  .toolbar, .status-bar, .editor-pane, .divider, .welcome, .toast, dialog {
    display: none !important;
  }
  .panes { display: block; }
  .preview-pane {
    overflow: visible; padding: 0; background: none;
  }
  /* The sheet flattens: @page owns the paper margin when printing, so keeping
     the sheet's own percentage padding would apply the margin twice. The
     shadow and the desk are chrome and simply go. */
  .sheet {
    width: auto; padding: 0; box-shadow: none;
  }
  .katex-display, .vega-lite-chart, .mermaid-diagram, figure, .chart-error, .csl-entry { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  @page { margin: 25mm; }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/lib/styleContract.test.ts`
Expected: PASS. The `keeps a caption on the same page as its figure when
printing` test in `describe('figure alignment', …)` must still pass — the
`break-inside: avoid` line is unchanged.

- [ ] **Step 5: Verify against a real export**

Run: `wails3 task build && wails3 task run`

Open a document with a heading, a chart, an image with a caption and a
bibliography. Export a PDF through the existing File → Export PDF… and check:
margins look like 25mm and are **not** doubled; no chart or caption is split
across a page break; the text is the serif face, not San Francisco.

- [ ] **Step 6: Commit**

```bash
git add frontend/public/style.css frontend/src/lib/styleContract.test.ts
git commit -m "refactor: reduce the print block to what only print needs

Hiding chrome, the page margin, break-avoidance, and flattening the sheet so
@page's margin is not applied on top of the sheet's own. Everything else it
used to do was re-lighting a dark document.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Export without the print panel

Export splits from printing. The forcing argument is in the spec: the sheet
must know its paper size to be drawn, so paper size is now a setting — and the
print panel's own paper picker is therefore a second source of truth for the
same fact. A user who picks US Letter in the panel gets a PDF whose measure
does not match the sheet they wrote against.

**Files:**
- Modify: `print_darwin.go`
- Create: `print_test.go`
- Modify: `documentservice.go:172-180`
- Modify: `menu.go:89-91`

**Interfaces:**
- Consumes: `Settings.PaperSize` and `Settings.PrintOrientation` (Task 4).
- Produces: `DocumentService.ExportPDF(docPath string)` — note the **new
  parameter**, so the frontend binding changes; and
  `DocumentService.PrintDocument()`, which keeps the panel.

- [ ] **Step 1: Write the failing tests for the pure helpers**

Create `print_test.go`. These are the parts that can be tested without a
window, and they are where the arithmetic errors would live:

```go
package main

import "testing"

func TestPaperPointsCoversBothPapersAndOrientations(t *testing.T) {
	cases := []struct {
		size      string
		landscape bool
		w, h      float64
	}{
		{"a4", false, 595.28, 841.89},
		{"a4", true, 841.89, 595.28},
		{"letter", false, 612, 792},
		{"letter", true, 792, 612},
		// An unknown paper falls back to A4 rather than to zero, which would
		// produce a PDF with no imageable area at all.
		{"foolscap", false, 595.28, 841.89},
	}
	for _, c := range cases {
		w, h := paperPoints(c.size, c.landscape)
		if w != c.w || h != c.h {
			t.Errorf("paperPoints(%q, %v) = %v x %v, want %v x %v",
				c.size, c.landscape, w, h, c.w, c.h)
		}
	}
}

func TestPDFExportFilenameSwapsTheExtension(t *testing.T) {
	cases := map[string]string{
		"/Users/x/Papers/thesis.md":       "thesis.pdf",
		"/Users/x/Papers/notes.markdown":  "notes.pdf",
		"/Users/x/Papers/no-extension":    "no-extension.pdf",
		"/Users/x/Papers/dotted.name.md":  "dotted.name.pdf",
		// An unsaved document has no path at all; the dialog still needs a
		// name to offer.
		"": "untitled.pdf",
	}
	for in, want := range cases {
		if got := pdfExportFilename(in); got != want {
			t.Errorf("pdfExportFilename(%q) = %q, want %q", in, got, want)
		}
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./. -run 'TestPaperPoints|TestPDFExportFilename'`
Expected: FAIL to compile — `undefined: paperPoints`, `undefined: pdfExportFilename`.

- [ ] **Step 3: Write the pure helpers**

Add to `documentservice.go` (they are plain Go, so they stay out of the cgo
file and remain testable on any platform):

```go
// paperPoints returns a paper's width and height in PostScript points, which
// is the unit NSPrintInfo works in. An unknown name falls back to A4 rather
// than to a zero-sized page.
func paperPoints(size string, landscape bool) (float64, float64) {
	w, h := 595.28, 841.89 // A4
	if size == "letter" {
		w, h = 612, 792
	}
	if landscape {
		return h, w
	}
	return w, h
}

// pdfExportFilename is the name the save dialog offers: the document's own
// name with a .pdf extension. An unsaved document has no path, so it gets the
// same placeholder Save As uses.
func pdfExportFilename(docPath string) string {
	if docPath == "" {
		return "untitled.pdf"
	}
	base := filepath.Base(docPath)
	return strings.TrimSuffix(base, filepath.Ext(base)) + ".pdf"
}
```

`documentservice.go` already imports `fmt` and `path/filepath`; **add
`strings`**, which it does not currently import.

- [ ] **Step 4: Run the tests**

Run: `go test ./. -run 'TestPaperPoints|TestPDFExportFilename' -v`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the panel-free export operation**

In `print_darwin.go`, add this C function after `hermesPrintWebView`. It is
the same shape minus the panel, which is the entire point: with no panel there
is no paper substitution, so the pagination-goes-stale hazard documented above
`hermesPrintWebView` does not apply to this path at all.

```c
// Renders the frontmost window's webview straight to a PDF at `path`, with no
// print panel.
//
// The ordering hazard documented on hermesPrintWebView does not apply here,
// and that is the reason this function exists rather than reusing that one.
// There, the panel substitutes the chosen printer's paper size after
// WKPrintingView has already counted pages, and the operation renders a page
// count that no longer matches the reflowed content — which silently dropped
// the tail of long documents. Here the print info is final before the
// operation is built, because nothing is ever given the chance to change it.
//
// Margins are zero on purpose. The CSS @page rule supplies the 25mm page
// margin, and NSPrintInfo's margins compound with it rather than replacing
// it — a non-zero value here would be added to the CSS margin and every
// export would come out with margins roughly double what the sheet drew.
//
// Returns 0 if the webview could not be located.
static int hermesExportWebViewPDF(const char *path, int landscape,
                                  double paperWidth, double paperHeight) {
	if (@available(macOS 11.0, *)) {
		NSWindow *window = [NSApp keyWindow] ?: [NSApp mainWindow];
		if (!window) {
			return 0;
		}
		WKWebView *webView = hermesFindWebView(window.contentView);
		if (!webView) {
			return 0;
		}

		NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];

		NSPrintInfo *pInfo = [[NSPrintInfo sharedPrintInfo] copy];
		pInfo.horizontalPagination = NSPrintingPaginationModeAutomatic;
		pInfo.verticalPagination = NSPrintingPaginationModeAutomatic;
		pInfo.paperSize = NSMakeSize(paperWidth, paperHeight);
		pInfo.orientation = landscape ? NSPaperOrientationLandscape
		                              : NSPaperOrientationPortrait;
		pInfo.leftMargin = 0;
		pInfo.rightMargin = 0;
		pInfo.topMargin = 0;
		pInfo.bottomMargin = 0;
		pInfo.jobDisposition = NSPrintSaveJob;
		[pInfo.dictionary setObject:url forKey:NSPrintJobSavingURL];

		NSPrintOperation *po = [webView printOperationWithPrintInfo:pInfo];
		po.showsPrintPanel = NO;
		po.showsProgressPanel = YES;
		// runOperationModalForWindow, not runOperation: WKPrintingView needs
		// the runloop to service the web content process, and [po runOperation]
		// deadlocks on the main thread.
		[po runOperationModalForWindow:window
		                      delegate:nil
		                didRunSelector:nil
		                   contextInfo:nil];
		return 1;
	}
	return 0;
}
```

And the Go wrapper at the bottom of the file:

```go
// exportPDF renders the webview to a PDF at path with no print panel, so the
// paper the sheet was drawn at is the paper the export uses. Returns false if
// the webview wasn't found.
func exportPDF(path string, landscape bool, paperWidth, paperHeight float64) bool {
	l := C.int(0)
	if landscape {
		l = 1
	}
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	return application.InvokeSyncWithResult(func() bool {
		return C.hermesExportWebViewPDF(cPath, l, C.double(paperWidth), C.double(paperHeight)) != 0
	})
}
```

Add `#include <stdlib.h>` to the cgo preamble and `"unsafe"` to the Go
imports, for `C.free`.

- [ ] **Step 6: Rewrite the service methods**

In `documentservice.go`, replace `ExportPDF` with these two:

```go
// ExportPDF asks for a destination and renders the document there with no
// print panel. The panel is deliberately not used: paper size is a setting
// now, because the preview draws the sheet at that size, and the panel's own
// paper picker would be a second source of truth for the same fact — a user
// who changed it there would get a PDF whose measure did not match the sheet
// they wrote against.
func (s *DocumentService) ExportPDF(docPath string) error {
	if s.window == nil {
		return nil
	}
	path, err := application.Get().Dialog.SaveFile().
		SetMessage("Export PDF").
		SetFilename(pdfExportFilename(docPath)).
		PromptForSingleSelection()
	if err != nil || path == "" {
		return err
	}
	set := s.settings.get()
	landscape := set.PrintOrientation == "landscape"
	w, h := paperPoints(set.PaperSize, landscape)
	if !exportPDF(path, landscape, w, h) {
		return fmt.Errorf("could not export the PDF")
	}
	return nil
}

// PrintDocument opens the system print panel. Picking a printer and a tray is
// a job the panel is genuinely good at; picking paper is not, which is why
// export no longer goes through here.
func (s *DocumentService) PrintDocument() {
	if s.window == nil {
		return
	}
	if !printWithOrientation(s.settings.get().PrintOrientation == "landscape") {
		// Fallback: Wails' built-in print (hardcodes landscape upstream).
		_ = s.window.Print()
	}
}
```

- [ ] **Step 7: Wire up the menu**

In `menu.go`, replace the existing `file.Add("Export PDF…")` block:

```go
	file.Add("Export PDF…").SetAccelerator("cmdorctrl+e").OnClick(func(*application.Context) {
		app.Event.Emit("menu:export-pdf")
	})
	file.Add("Print…").SetAccelerator("cmdorctrl+p").OnClick(func(*application.Context) {
		docs.PrintDocument()
	})
```

Export now goes through an event because it needs the document's path, which
only the frontend holds. In `frontend/src/App.svelte`, alongside the other
`Events.On` registrations in the same `onMount`:

```ts
    Events.On('menu:export-pdf', () => {
      void DocumentService.ExportPDF(path).catch((e) => toast(String(e)))
    })
```

`toast` is the existing helper at `App.svelte:92`; use it rather than adding
a second error path.

Add `menu:export-pdf` to the event list in `CLAUDE.md`'s Events section, which
enumerates every event `menu.go` emits.

- [ ] **Step 8: Regenerate bindings and verify the build**

Run: `wails3 task common:generate:bindings && go test ./. && go build -o /dev/null . && cd frontend && npx vitest run`
Expected: PASS. `ExportPDF` now takes a string in
`frontend/bindings/hermes/documentservice.ts`.

- [ ] **Step 9: Verify the export against a real file**

Run: `wails3 task build && wails3 task run`

Confirm the binary actually contains the change before trusting the app —
**`run` does not build**, and this plan's earlier tasks make it easy to launch
a stale one:

```bash
strings "bin/Hermes Editor" | grep hermesExportWebViewPDF
```

Then export a long document (several pages, ending in a bibliography) and
check all of:

1. **No panel appears** — a save dialog, then a progress panel.
2. **The last page is present.** Open the PDF and confirm the bibliography
   ends where the document does. This is the truncation class the old
   ordering guarded against; the new path avoids it structurally, but verify
   rather than assume.
3. **The margins are 25mm, not 50mm.** Measure in Preview (Tools →
   Show Inspector → Crop). If they are doubled, `NSPrintInfo`'s margins are
   compounding with `@page` and the zeroes in Step 5 did not take.
4. **The fonts are embedded:**

```bash
pdffonts ~/Desktop/thesis.pdf
```

Expected: every row's `emb` column reads `yes`, and the body face is a New
York variant. **If the body font is not embedded, stop and report it** — the
spec flags this as the one untested assumption, and an unembedded face is
rejected by journal submission portals. The remedy is bundling an open
academic serif instead, which is a separate piece of work.

5. **Paper size is honoured:** switch File → Paper Size → US Letter, export
   again, and confirm the page size changed (Preview's Inspector shows it).

- [ ] **Step 10: Commit**

```bash
git add print_darwin.go print_test.go documentservice.go menu.go frontend/src/App.svelte frontend/bindings CLAUDE.md
git commit -m "feat: export PDFs without the print panel

Paper size is a setting now, because the sheet is drawn at it — which makes
the print panel's own paper picker a second source of truth for the same
fact, and a PDF whose measure need not match the sheet the author wrote
against. Export gets a save dialog and a fixed NSPrintInfo; File -> Print...
keeps the panel, where choosing a printer belongs.

NSPrintInfo margins are zero on purpose: they compound with the CSS @page
margin rather than replacing it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Tick the roadmap

**Files:**
- Modify: `ROADMAP.md:353-359`

**Read `CLAUDE.md`'s note on editing the long prose documents before starting.**
`ROADMAP.md` has been corrupted twice by scripted edits that splice by string
index, both times pushed before anyone noticed. Use a single unique
`str.replace` with `assert s.count(old) == 1`, never index arithmetic.

- [ ] **Step 1: Record the before-shape**

```bash
grep -c '^- \[' ROADMAP.md; grep -c '^- \[x\]' ROADMAP.md; grep '^## ' ROADMAP.md
```

Note the three outputs.

- [ ] **Step 2: Replace the entry**

Replace the whole `- [ ] Settle the best styling and rendering approach…`
entry — all seven lines, through `…if it proves clunky.` — with a ticked one
recording what was decided and what it deleted. Follow the file's house style:
what changed, and the reasoning that is worth not rediscovering.

```markdown
- [x] Settle the best styling and rendering approach for the preview and the
      PDF. The question underneath the two the roadmap named: the preview had
      no document typography at all, so a paper rendered full-bleed in the
      macOS UI font and print was a set of patches on top. The preview is now
      a page — a white sheet on a desk, `ui-serif` at 11pt/1.5, true paper
      proportions from a new `PaperSize` setting crossed with the existing
      orientation, and a 25mm margin (up from 20mm, which gave an
      ~88-character measure). The sheet stays white in dark mode, which is the
      decision the rest follows from: the document region is always light, so
      the palette splits into theme-varying chrome and an invariant `--doc-*`
      set, the fifty-line `@media print` palette override is deleted rather
      than maintained, and so are the three figure-card tokens that mounted
      transparent figures against a dark ground. Print therefore no longer
      tracks the screen stylesheet because there is nothing left to track.
      Export left the print panel too: the sheet must know its paper size to
      be drawn, which made the panel's paper picker a second source of truth
      for the same fact. Accepted limitation: A4 is ~794px, so in a split view
      the sheet is often shrunk below true size — proportions stay right, the
      absolute measure does not. Design:
      [docs/superpowers/specs/2026-08-25-preview-and-pdf-styling-design.md](docs/superpowers/specs/2026-08-25-preview-and-pdf-styling-design.md).
```

- [ ] **Step 3: Verify the shape**

```bash
grep -c '^- \[' ROADMAP.md; grep -c '^- \[x\]' ROADMAP.md; grep '^## ' ROADMAP.md
```

Expected: the total `- [` count is **unchanged**, the `- [x]` count is
**exactly one higher**, and the `## ` headings are **identical** to Step 1.
If the total changed, the splice duplicated or dropped entries — revert with
`git checkout ROADMAP.md` and redo it with `str.replace`.

- [ ] **Step 4: Remove the superseded backlog entry**

The backlog's `Dialog-free PDF export (e.g. headless rendering) if the print
panel proves clunky.` line is now done. Delete that one line and re-run the
Step 3 checks (the backlog uses `- ` not `- [ ]`, so the checkbox counts
should not move at all).

- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: tick the preview and PDF styling item

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
