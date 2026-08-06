# Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A System / Light / Dark theme covering the app chrome, preview, editor, window background, and print output.

**Architecture:** One palette expressed as CSS custom properties on `:root`, overridden under `:root[data-theme="dark"]`. Everything downstream reads those variables — including CodeMirror, whose theme and syntax colours are emitted as `var(…)` so switching needs no reconfiguration. A pure `resolveTheme` decides light-or-dark from the setting plus the OS preference.

**Tech Stack:** Svelte 5 (runes, `mount`/`flushSync`), TypeScript, CodeMirror 6, Vitest, jsdom, Go 1.25 + Wails v3.

**Spec:** [docs/superpowers/specs/2026-08-05-dark-theme-design.md](../specs/2026-08-05-dark-theme-design.md)

## Global Constraints

- Frontend work is in `frontend/`; `settings.go`, `menu.go`, `main.go`, `CHANGELOG.md`, `ROADMAP.md` are at the repo ROOT. **Use an explicit `cd` in EVERY bash call** — the working directory does not reliably persist.
- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`).
- Verification: `npx vitest run`, `npm run check` (must report `0 ERRORS`), `npm run build` from `frontend/`. Go: `gofmt -l . | grep -v '^build/'` (must print nothing), `go vet ./.`, `go test ./.`, `go build -o /dev/null .` from the repo root — note `./.`, not `./...`.
- Baseline before starting: **181 frontend tests across 13 files**, Go tests passing.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Component tests: call `flushSync()` after `mount()` before asserting.** Svelte 5 runs `onMount` in a microtask.
- **jsdom has no layout engine and no CSS cascade resolution.** Never assert a computed colour or a rendered pixel. Colour correctness is a manual check; the automated tests here assert *structure* (which variables exist, that no literal colours leak) rather than appearance.
- After changing the `Settings` struct, regenerate bindings: `cd /Users/richarc/Development/hermes && wails3 task common:generate:bindings`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/theme.ts` (create) | `resolveTheme` (pure) and `applyTheme` (sets `data-theme`) |
| `src/lib/theme.test.ts` (create) | The six resolve cases |
| `src/lib/styleContract.test.ts` (create) | Guards the palette invariants by reading `style.css` as text |
| `public/style.css` (modify) | Palette variables, dark overrides, chart cards, print forcing light |
| `src/Editor.svelte` (modify) | `EditorView.theme` + `HighlightStyle`, all values `var(…)` |
| `src/Editor.test.ts` (modify) | Asserts the emitted stylesheet uses variables, not literals |
| `src/App.svelte` (modify) | Read setting, subscribe to the media query, apply |
| `src/App.test.ts` (modify) | `data-theme` behaviour, especially the `system` case |
| `settings.go`, `settings_test.go`, `menu.go`, `main.go` | `Theme` preference, View → Appearance radios, window background |

---

## Task 1: Resolving the theme

**Files:**
- Create: `frontend/src/lib/theme.ts`, `frontend/src/lib/theme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ThemeSetting = 'system' | 'light' | 'dark'`, `type ResolvedTheme = 'light' | 'dark'`, `resolveTheme(setting: ThemeSetting, systemPrefersDark: boolean): ResolvedTheme`, `applyTheme(resolved: ResolvedTheme): void`. Task 6 calls both.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/theme.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { resolveTheme, applyTheme } from './theme'

describe('resolveTheme', () => {
  // All six combinations: the entire decision surface, so state it exhaustively.
  it('follows the system preference when the setting is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('ignores the system preference when the setting is explicit', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('applyTheme', () => {
  it('always sets data-theme rather than removing it', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('light')
    // Set, not removed: a document is never momentarily unstyled while switching.
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/theme.test.ts`
Expected: FAIL — cannot resolve `./theme`.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/theme.ts`:

```ts
export type ThemeSetting = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/**
 * Decides the theme actually in force. Pure, so the whole decision surface —
 * three settings against two system states — is testable without a DOM.
 */
export function resolveTheme(
  setting: ThemeSetting,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (setting === 'system') return systemPrefersDark ? 'dark' : 'light'
  return setting
}

/**
 * Always sets the attribute rather than removing it for light. The light
 * palette is both the `:root` default and what `[data-theme="light"]`
 * selects, so the document is never momentarily unstyled mid-switch.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/theme.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/richarc/Development/hermes/frontend
git add src/lib/theme.ts src/lib/theme.test.ts
git commit -m "$(cat <<'EOF'
feat: add theme resolution

resolveTheme is pure, so all six combinations of setting and system
preference are covered without a DOM. applyTheme always sets data-theme
rather than removing it for light, so the document is never momentarily
unstyled while switching.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extract the palette

**Files:**
- Modify: `frontend/public/style.css`
- Create: `frontend/src/lib/styleContract.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the variable names Task 3 overrides and Task 4 reads. Exact names are listed in Step 3 — later tasks depend on them character for character.

**This task must not change how the app looks.** It replaces literal colours with variables whose light values are exactly today's colours. A reviewer should be able to confirm light mode is byte-identical in appearance.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/styleContract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS = readFileSync(
  join(fileURLToPath(import.meta.url), '../../../public/style.css'),
  'utf8',
)

/** Everything between `:root {` … `}` blocks — where literal colours belong. */
function paletteBlocks(css: string): string {
  return css
    .split('\n')
    .filter((l) => /^\s*--/.test(l))
    .join('\n')
}

/** The rules — everything that is not a custom-property declaration. */
function ruleBody(css: string): string {
  return css
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n')
}

describe('style.css palette contract', () => {
  it('declares no literal colours outside the palette', () => {
    // Colours are decided in one place. A literal here means a rule that
    // cannot follow the theme — the exact way a half-dark UI ships.
    const literals = ruleBody(CSS).match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []
    expect(literals).toEqual([])
  })

  it('defines every variable that the rules reference', () => {
    const used = new Set(
      [...CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]),
    )
    const defined = new Set(
      [...paletteBlocks(CSS).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    )
    const missing = [...used].filter((v) => !defined.has(v))
    expect(missing).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/styleContract.test.ts`
Expected: FAIL on the first test — the current stylesheet is full of literals (`#ffffff`, `#ddd`, `rgba(0, 0, 0, 0.4)` and so on).

- [ ] **Step 3: Add the palette and swap every reference**

At the top of `frontend/public/style.css`, replace the current `:root` rule:

```css
/* Light document editor by design: opt out of the OS dark scheme and the
   translucent window backdrop so colors don't invert under macOS dark mode. */
:root { color-scheme: light; }
```

with the palette. Every literal colour in the file moves here and nowhere else:

```css
/* The single place a colour is decided. Rules below reference these only —
   styleContract.test.ts fails the build if a literal colour appears in a rule.
   The dark block must define exactly the same names; that is also enforced. */
:root {
  color-scheme: light;

  --bg: #ffffff;
  --fg: #000000;
  --border: #ddd;
  --border-strong: #ccc;
  --muted: #666;
  --muted-strong: #555;
  --surface: #f5f5f5;
  --surface-code-block: #f6f6f6;
  --surface-code-inline: #f2f2f2;
  --divider: #eee;
  --link: #0b62d6;
  --overlay-bg: #ffffff;
  --backdrop: rgba(0, 0, 0, 0.4);
  --toast-bg: #333333;
  --toast-fg: #ffffff;
  --chart-error-fg: #cc0000;
  --chart-error-bg: #fff5f5;
  --cite-error-fg: #cc0000;
  --cite-error-bg: #fff5f5;

  /* Figures are cards only in dark mode; light mode keeps today's layout
     exactly, which is why these are transparent and zero here. */
  --figure-bg: transparent;
  --figure-pad: 0;
  --figure-radius: 0;

  /* CodeMirror reads these through var() in its generated stylesheet, so
     switching themes needs no reconfiguration. See Editor.svelte. */
  --editor-bg: #ffffff;
  --editor-fg: #000000;
  --editor-caret: #000000;
  --editor-selection: #d7d4f0;
  --editor-gutter-bg: #f5f5f5;
  --editor-gutter-fg: #6c6c6c;
  --editor-active-line: #cceeff44;

  --syn-heading: #0b3d91;
  --syn-emphasis: #6a4a00;
  --syn-code: #7a1f7a;
  --syn-link: #0b62d6;
  --syn-quote: #555555;
  --syn-meta: #888888;
}
```

Then replace every literal in the rules below with its variable. The complete
substitution list, in file order:

| Rule | Was | Becomes |
|---|---|---|
| `html, body` background | `#ffffff` | `var(--bg)` |
| `html, body` color | `#000000` | `var(--fg)` |
| `.toolbar` border-bottom | `#ddd` | `var(--border)` |
| `.editor-pane` border-right | `#ddd` | `var(--border)` |
| `.preview-pane blockquote` border-left | `#ddd` | `var(--border)` |
| `.preview-pane blockquote` color | `#555` | `var(--muted-strong)` |
| `.preview-pane pre` background | `#f6f6f6` | `var(--surface-code-block)` |
| `.preview-pane :not(pre) > code` background | `#f2f2f2` | `var(--surface-code-inline)` |
| `.preview-pane th, td` border | `#ddd` | `var(--border)` |
| `.preview-pane hr` border-top | `#ddd` | `var(--border)` |
| `.preview-pane a` color | `#0b62d6` | `var(--link)` |
| `.divider` background | `#eee` | `var(--divider)` |
| `.status-bar` border-top | `#ddd` | `var(--border)` |
| `.status-bar` color | `#666` | `var(--muted)` |
| `.welcome` background | `white` | `var(--overlay-bg)` |
| `.welcome-actions button.welcome-action` border | `#ccc` | `var(--border-strong)` |
| `.welcome-actions button.welcome-action` background | `#f5f5f5` | `var(--surface)` |
| `.modal-backdrop` background | `rgba(0, 0, 0, 0.4)` | `var(--backdrop)` |
| `.modal` background | `white` | `var(--overlay-bg)` |
| `.toast` background | `#333` | `var(--toast-bg)` |
| `.toast` color | `white` | `var(--toast-fg)` |
| `.chart-error` border | `#cc0000` | `var(--chart-error-fg)` |
| `.chart-error` background | `#fff5f5` | `var(--chart-error-bg)` |
| `.chart-error` color | `#cc0000` | `var(--chart-error-fg)` |
| `.cite-error` color | `#cc0000` | `var(--cite-error-fg)` |
| `.cite-error` background | `#fff5f5` | `var(--cite-error-bg)` |

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/styleContract.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Confirm nothing else broke, and commit**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check && npm run build`
Expected: 186 tests across 15 files; `0 ERRORS`; build succeeds.

```bash
cd /Users/richarc/Development/hermes/frontend
git add public/style.css src/lib/styleContract.test.ts
git commit -m "$(cat <<'EOF'
refactor: move every colour into a palette of custom properties

Pure refactor — every light value is exactly today's colour, so the app
looks unchanged. styleContract.test.ts now fails the build if a literal
colour appears in a rule rather than the palette, which is the invariant
that keeps a half-dark UI from shipping later.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The dark palette, chart cards, and print

**Files:**
- Modify: `frontend/public/style.css`, `frontend/src/lib/styleContract.test.ts`

**Interfaces:**
- Consumes: the variable names from Task 2.
- Produces: `:root[data-theme="dark"]` overrides. Task 6 activates them by setting the attribute.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/styleContract.test.ts`:

```ts
function blockNames(css: string, selector: string): string[] {
  const start = css.indexOf(selector + ' {')
  if (start === -1) return []
  const end = css.indexOf('\n}', start)
  return [...css.slice(start, end).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
}

describe('dark palette', () => {
  it('overrides exactly the variables the light palette defines', () => {
    const light = blockNames(CSS, ':root')
    const dark = blockNames(CSS, ':root[data-theme="dark"]')
    // A name defined light-only is a rule that stays light in dark mode —
    // the single most likely way this feature ships half-finished.
    expect([...light].sort()).toEqual([...dark].sort())
  })

  it('forces the light palette back for print', () => {
    // Browsers drop background colours when printing but honour text colour,
    // so a dark theme would otherwise export a PDF with near-white text.
    const print = CSS.slice(CSS.indexOf('@media print'))
    expect(print).toContain(':root[data-theme="dark"]')
    expect(print).toContain('--fg:')
    expect(print).toContain('--bg:')
    expect(print).toContain('--figure-bg:')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/styleContract.test.ts`
Expected: FAIL — there is no dark block yet, so the name lists differ.

- [ ] **Step 3: Add the dark palette**

Immediately after the `:root { … }` palette block in `frontend/public/style.css`:

```css
/* Must define exactly the same names as the light palette above — enforced by
   styleContract.test.ts, because a name defined light-only is a rule that
   silently stays light in dark mode.

   --bg is duplicated in main.go as the window's BackgroundColour, because Go
   cannot read this file. If you change it here, change it there too. */
:root[data-theme="dark"] {
  color-scheme: dark;

  --bg: #1e1e1e;
  --fg: #e4e4e4;
  --border: #3a3a3a;
  --border-strong: #4a4a4a;
  --muted: #9a9a9a;
  --muted-strong: #b0b0b0;
  --surface: #2a2a2a;
  --surface-code-block: #262626;
  --surface-code-inline: #2c2c2c;
  --divider: #333333;
  --link: #6ea8fe;
  --overlay-bg: #1e1e1e;
  --backdrop: rgba(0, 0, 0, 0.6);

  /* Inverted deliberately: a dark toast on a dark app does not read as an
     overlay. Light-on-dark is what makes it stand out here. */
  --toast-bg: #f0f0f0;
  --toast-fg: #1a1a1a;

  --chart-error-fg: #ff8080;
  --chart-error-bg: #3a2222;
  --cite-error-fg: #ff8080;
  --cite-error-bg: #4a2222;

  /* Vega draws in dark ink on a transparent ground, so a figure needs a light
     card to stay readable — and this way charts match the exported PDF and the
     hydrator's spec-text cache stays valid across a theme change. */
  --figure-bg: #ffffff;
  --figure-pad: 12px;
  --figure-radius: 6px;

  --editor-bg: #1e1e1e;
  --editor-fg: #e4e4e4;
  --editor-caret: #e4e4e4;
  --editor-selection: #2f5d8c;
  --editor-gutter-bg: #1e1e1e;
  --editor-gutter-fg: #6a6a6a;
  --editor-active-line: #ffffff0d;

  --syn-heading: #9dc0ff;
  --syn-emphasis: #e0c07a;
  --syn-code: #d7a3d7;
  --syn-link: #6ea8fe;
  --syn-quote: #b0b0b0;
  --syn-meta: #8a8a8a;
}
```

- [ ] **Step 4: Add the figure card rule**

Next to the other `.preview-pane` rules:

```css
.preview-pane .vega-lite-chart {
  background: var(--figure-bg);
  padding: var(--figure-pad);
  border-radius: var(--figure-radius);
}
```

In light mode these resolve to `transparent` / `0` / `0`, so light mode is unchanged.

- [ ] **Step 5: Force the light palette for print**

Inside the existing `@media print { … }` block, as its first rule:

```css
  /* Exported PDFs are always light. Browsers drop background colours when
     printing but honour text colour, so without this a dark-theme export is
     near-white text on white paper — invisible on screen, total on paper.
     The dark selector is listed too and comes last, so it wins the tie. */
  :root, :root[data-theme="dark"] {
    color-scheme: light;
    --bg: #ffffff;
    --fg: #000000;
    --border: #ddd;
    --border-strong: #ccc;
    --muted: #666;
    --muted-strong: #555;
    --surface: #f5f5f5;
    --surface-code-block: #f6f6f6;
    --surface-code-inline: #f2f2f2;
    --divider: #eee;
    --link: #0b62d6;
    --overlay-bg: #ffffff;
    --backdrop: rgba(0, 0, 0, 0.4);
    --toast-bg: #333333;
    --toast-fg: #ffffff;
    --chart-error-fg: #cc0000;
    --chart-error-bg: #fff5f5;
    --cite-error-fg: #cc0000;
    --cite-error-bg: #fff5f5;
    --figure-bg: transparent;
    --figure-pad: 0;
    --figure-radius: 0;
    --editor-bg: #ffffff;
    --editor-fg: #000000;
    --editor-caret: #000000;
    --editor-selection: #d7d4f0;
    --editor-gutter-bg: #f5f5f5;
    --editor-gutter-fg: #6c6c6c;
    --editor-active-line: #cceeff44;
    --syn-heading: #0b3d91;
    --syn-emphasis: #6a4a00;
    --syn-code: #7a1f7a;
    --syn-link: #0b62d6;
    --syn-quote: #555555;
    --syn-meta: #888888;
  }
```

Specificity note: inside `@media print`, a bare `:root` is *less* specific than
`:root[data-theme="dark"]`, so listing only `:root` would lose. Both selectors
are listed so specificity ties and source order decides — and this block comes
after the dark palette.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/lib/styleContract.test.ts`
Expected: PASS, 4 tests.

Note: the first test in this file (no literal colours in rules) still passes,
because the print block's declarations are custom properties, which that test
excludes by design.

- [ ] **Step 7: Full run and commit**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check && npm run build`
Expected: 188 tests across 15 files; `0 ERRORS`; build succeeds.

```bash
cd /Users/richarc/Development/hermes/frontend
git add public/style.css src/lib/styleContract.test.ts
git commit -m "$(cat <<'EOF'
feat: add the dark palette, figure cards, and light print output

The dark block must define exactly the same names as the light one, which a
test enforces — a name defined light-only is a rule that silently stays
light in dark mode.

Figures get a light card in dark mode only. Vega draws in dark ink on a
transparent ground, so the card is what keeps charts readable, and it means
charts match the exported PDF and the chart cache stays valid across a
theme change.

Print re-declares the light palette. Browsers drop background colours when
printing but honour text colour, so without this a dark-theme export is
near-white text on white paper.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The editor theme

**Files:**
- Modify: `frontend/src/Editor.svelte`, `frontend/src/Editor.test.ts`

**Interfaces:**
- Consumes: the `--editor-*` and `--syn-*` variables from Tasks 2 and 3.
- Produces: nothing later tasks call.

**Why there is no `Compartment` here.** This was spiked before the plan was
written. `EditorView.theme()` and `HighlightStyle.define()` emit ordinary CSS
and `var(…)` values survive into it, so theme switching is pure CSS. Two facts
make it work: `dark: true` is unnecessary (it only adds a class that base-theme
`&dark` / `&light` rules key off, and our theme overrides every such rule that
matters), and our rules win because `&light` compiles to a *single* class so
specificity ties, and ours are emitted later.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/Editor.test.ts`:

```ts
describe('Editor theme', () => {
  it('styles itself with CSS variables, never literal colours', () => {
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    // Our theme's rules — the ones carrying var(--editor-*) — must exist.
    expect(css).toContain('var(--editor-bg)')
    expect(css).toContain('var(--editor-selection)')
    expect(css).toContain('var(--editor-gutter-bg)')
    expect(css).toContain('var(--syn-heading)')

    cleanup()
  })

  it('emits our theme after the base theme, so ours wins the specificity tie', () => {
    const { cleanup } = mountEditor()

    const css = [...document.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
    const lines = css.split('\n')
    const base = lines.findIndex((l) => /\.\S+ \.cm-selectionBackground \{background: #/.test(l))
    const ours = lines.findIndex((l) => l.includes('var(--editor-selection)'))
    // CodeMirror's `&light` base rule and ours have equal specificity — one
    // class each — so source order decides. If a future CodeMirror raised base
    // specificity this would break, and the symptom would be a light selection
    // highlight in dark mode rather than an error.
    expect(base).toBeGreaterThanOrEqual(0)
    expect(ours).toBeGreaterThan(base)

    cleanup()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/Editor.test.ts`
Expected: FAIL — no `var(--editor-bg)` appears; the editor has no theme yet.

- [ ] **Step 3: Implement**

In `frontend/src/Editor.svelte`, add to the imports:

```ts
  import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
  import { tags } from '@lezer/highlight'
```

Add the theme and highlight style above the component's `onMount`:

```ts
  // Every colour is a CSS variable, so switching the app theme restyles the
  // editor with no reconfiguration — no Compartment, no dispatch, nothing to
  // get out of step. Verified: var() survives into the stylesheet CodeMirror
  // generates, and our rules are emitted after the base theme's, which is what
  // wins the specificity tie. `dark: true` is deliberately omitted; it only
  // adds a class for base `&dark` rules, all of which we override below.
  //
  // If a future CodeMirror raises base-theme specificity this stops working,
  // and the symptom is a light selection highlight in dark mode, not an error.
  const hermesTheme = EditorView.theme({
    '&': { backgroundColor: 'var(--editor-bg)', color: 'var(--editor-fg)' },
    '.cm-content': { caretColor: 'var(--editor-caret)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--editor-caret)' },
    '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
      { backgroundColor: 'var(--editor-selection)' },
    '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-gutter-bg)',
      color: 'var(--editor-gutter-fg)',
      border: 'none',
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)' },
  })

  // Markdown highlighting is modest by design — this is a writing tool.
  const hermesHighlight = HighlightStyle.define([
    { tag: tags.heading, color: 'var(--syn-heading)', fontWeight: 'bold' },
    { tag: tags.emphasis, color: 'var(--syn-emphasis)', fontStyle: 'italic' },
    { tag: tags.strong, color: 'var(--syn-emphasis)', fontWeight: 'bold' },
    { tag: tags.monospace, color: 'var(--syn-code)' },
    { tag: tags.link, color: 'var(--syn-link)' },
    { tag: tags.url, color: 'var(--syn-link)' },
    { tag: tags.quote, color: 'var(--syn-quote)' },
    { tag: tags.meta, color: 'var(--syn-meta)' },
  ])
```

Add both to the `extensions` array in `onMount`, after `basicSetup` so they
override its defaults:

```ts
        basicSetup,
        hermesTheme,
        syntaxHighlighting(hermesHighlight),
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/Editor.test.ts`
Expected: PASS.

- [ ] **Step 5: Full run and commit**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check && npm run build`
Expected: 190 tests across 15 files; `0 ERRORS`; build succeeds.

```bash
cd /Users/richarc/Development/hermes/frontend
git add src/Editor.svelte src/Editor.test.ts
git commit -m "$(cat <<'EOF'
feat: theme the editor from the app's CSS variables

EditorView.theme and HighlightStyle emit ordinary CSS and var() values
survive into it, so the editor follows the app theme with no Compartment
and no reconfiguration dispatch. dark: true is omitted deliberately — it
only adds a class for base &dark rules, all of which this theme overrides.

The tests pin both halves of why this works: that the rules use variables
rather than literals, and that ours are emitted after the base theme's,
which is what wins the specificity tie.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: The Theme preference, the menu, and the window

**Files:**
- Modify: `settings.go`, `settings_test.go`, `menu.go`, `main.go` (all at the repo root)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Settings.Theme string` with json tag `theme`, reachable from the frontend as `(await DocumentService.Settings()).theme`. Task 6 reads it.

**The two-places problem.** `main.go` needs the dark background colour but Go
cannot read the CSS. `#1e1e1e` is therefore written in both `style.css` (as the
dark `--bg`) and here as `NewRGB(30, 30, 30)`. Both sites carry a comment
naming the other. They are in this one task so they are chosen together.

- [ ] **Step 1: Write the failing test**

Append to `settings_test.go`:

```go
func TestThemeDefaultsToSystem(t *testing.T) {
	s := newTestService(t)
	if got := s.Settings().Theme; got != "system" {
		t.Errorf("want system default, got %q", got)
	}
}

func TestThemePersists(t *testing.T) {
	recentsPath := filepath.Join(t.TempDir(), "recents.json")
	s := NewDocumentService(recentsPath)

	next := s.Settings()
	next.Theme = "dark"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	if got := NewDocumentService(recentsPath).Settings().Theme; got != "dark" {
		t.Errorf("want dark persisted, got %q", got)
	}
}

func TestThemeNormalisesUnknownValues(t *testing.T) {
	s := newTestService(t)
	for _, bad := range []string{"", "solarized", "DARK", "auto"} {
		if err := s.UpdateSettings(Settings{Theme: bad}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", bad, err)
		}
		if got := s.Settings().Theme; got != "system" {
			t.Errorf("want %q normalised to system, got %q", bad, got)
		}
	}
}

func TestThemeAcceptsAllThreeLegalValues(t *testing.T) {
	s := newTestService(t)
	for _, want := range []string{"system", "light", "dark"} {
		if err := s.UpdateSettings(Settings{Theme: want}); err != nil {
			t.Fatalf("UpdateSettings(%q): %v", want, err)
		}
		if got := s.Settings().Theme; got != want {
			t.Errorf("want %q preserved, got %q", want, got)
		}
	}
}

func TestThemeIsIndependentOfTheOtherSettings(t *testing.T) {
	s := newTestService(t)
	if err := s.UpdateSettings(Settings{
		PrintOrientation: "landscape",
		SyncScrolling:    true,
		Theme:            "dark",
	}); err != nil {
		t.Fatal(err)
	}
	next := s.Settings()
	next.Theme = "light"
	if err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	got := s.Settings()
	if got.PrintOrientation != "landscape" || !got.SyncScrolling {
		t.Errorf("changing the theme disturbed the other settings: %+v", got)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes && go test ./. -run TestTheme`
Expected: FAIL to compile — `Theme` is not a field of `Settings`.

- [ ] **Step 3: Add the field and the clamp**

In `settings.go`, extend the struct and the defaults:

```go
type Settings struct {
	PrintOrientation string `json:"printOrientation"`
	SyncScrolling    bool   `json:"syncScrolling"`
	Theme            string `json:"theme"`
}

func defaultSettings() Settings {
	return Settings{PrintOrientation: "portrait", SyncScrolling: false, Theme: "system"}
}
```

In `normalise`, add the clamp beside the orientation one. Unlike
`SyncScrolling`, this field *does* need one — only three values are legal:

```go
	if s.Theme != "system" && s.Theme != "light" && s.Theme != "dark" {
		s.Theme = defaultSettings().Theme
	}
```

- [ ] **Step 4: Run the Go tests**

Run: `cd /Users/richarc/Development/hermes && go test ./.`
Expected: PASS.

- [ ] **Step 5: Add the Appearance submenu**

In `menu.go`, inside the existing View submenu block, after the Sync Scrolling
checkbox:

```go
	view.AddSeparator()
	appearance := view.AddSubmenu("Appearance")
	themes := []struct {
		label string
		value string
	}{
		{"System", "system"},
		{"Light", "light"},
		{"Dark", "dark"},
	}
	for _, t := range themes {
		value := t.value
		appearance.AddRadio(t.label, viewCurrent.Theme == value).OnClick(func(*application.Context) {
			// Read-modify-write the whole settings value, so this menu only
			// ever changes the field it owns.
			next := docs.Settings()
			next.Theme = value
			if err := docs.UpdateSettings(next); err != nil {
				log.Printf("could not save theme: %v", err)
			}
		})
	}
```

- [ ] **Step 6: Make the window background follow the setting**

In `main.go`, replace the hardcoded background. The `docs` service already
exists above this call, so the setting is readable:

```go
	// The window background is what shows for the moment before the webview
	// paints. #1e1e1e here is the same value as the dark --bg in
	// frontend/public/style.css; Go cannot read that file, so if you change one
	// change the other.
	//
	// "system" keeps white: resolving it would mean reading the OS appearance
	// through cgo, which is disproportionate for a flash at launch.
	windowBg := application.NewRGB(255, 255, 255)
	if docs.Settings().Theme == "dark" {
		windowBg = application.NewRGB(30, 30, 30)
	}
```

and use `BackgroundColour: windowBg` in the window options.

- [ ] **Step 7: Verify the whole Go side**

Run:
```bash
cd /Users/richarc/Development/hermes && gofmt -l . | grep -v '^build/' ; go vet ./. && go test ./. && go build -o /dev/null .
```
Expected: no gofmt output, vet clean, tests pass, build succeeds.

- [ ] **Step 8: Regenerate bindings and commit**

```bash
cd /Users/richarc/Development/hermes && wails3 task common:generate:bindings
cd frontend && npm run check
```
Expected: `frontend/bindings/hermes/models.ts` gains `theme: string`; `0 ERRORS`.

```bash
cd /Users/richarc/Development/hermes
git add settings.go settings_test.go menu.go main.go frontend/bindings
git commit -m "$(cat <<'EOF'
feat: add the Theme preference, Appearance menu, and window background

Three radios under View → Appearance, persisted alongside the other
preferences. Unlike SyncScrolling this field does need a normalise clamp,
since only three values are legal.

The window background follows the setting for light and dark. "system"
keeps white: resolving it would mean reading the OS appearance through cgo,
which is disproportionate for a flash before the webview paints. The dark
value is necessarily duplicated from style.css because Go cannot read it —
both sites carry a comment naming the other.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire the theme into the app

**Files:**
- Modify: `frontend/src/App.svelte`, `frontend/src/App.test.ts`

**Interfaces:**
- Consumes: `resolveTheme`, `applyTheme`, `ThemeSetting` from Task 1; `Settings.theme` from Task 5.
- Produces: the finished feature.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/App.test.ts`. The `vi.hoisted` block already has a
`settings` holder from the scroll-sync work — extend its shape with `theme`.

```ts
describe('theme', () => {
  // jsdom's matchMedia is not implemented; install a controllable fake.
  function stubMatchMedia(prefersDark: boolean) {
    const listeners: Array<(e: { matches: boolean }) => void> = []
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: () => ({
        matches: prefersDark,
        addEventListener: (_: string, cb: (e: { matches: boolean }) => void) =>
          listeners.push(cb),
        removeEventListener: () => {},
      }),
    })
    return { fire: (matches: boolean) => listeners.forEach((cb) => cb({ matches })) }
  }

  it('applies the persisted explicit theme', async () => {
    settings.current = { printOrientation: 'portrait', syncScrolling: false, theme: 'dark' }
    recents.current = []
    stubMatchMedia(false)
    mountApp()

    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    )
  })

  it('follows the system preference when the setting is system', async () => {
    settings.current = { printOrientation: 'portrait', syncScrolling: false, theme: 'system' }
    recents.current = []
    stubMatchMedia(true)
    mountApp()

    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    )
  })

  it('ignores the system preference when the setting is explicit', async () => {
    // The case most likely to regress: a system change must not override an
    // explicit choice.
    settings.current = { printOrientation: 'portrait', syncScrolling: false, theme: 'light' }
    recents.current = []
    const media = stubMatchMedia(false)
    mountApp()
    await vi.waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('light'),
    )

    media.fire(true)
    flushSync()

    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/App.test.ts`
Expected: FAIL — `data-theme` is never set; the app applies no theme.

- [ ] **Step 3: Implement**

In `frontend/src/App.svelte`, add to the imports:

```ts
  import { resolveTheme, applyTheme, type ThemeSetting } from './lib/theme'
```

Add state beside the other `$state` declarations:

```ts
  let themeSetting = $state<ThemeSetting>('system')
  let systemPrefersDark = $state(false)
```

Extend the existing `refreshSettings` to read the theme as well as sync
scrolling, and apply the result:

```ts
  async function refreshSettings() {
    const s = await DocumentService.Settings()
    syncScrolling = s.syncScrolling
    themeSetting = s.theme as ThemeSetting
    applyTheme(resolveTheme(themeSetting, systemPrefersDark))
  }
```

In `onMount`, subscribe to the media query. The listener stays attached
regardless of the setting; `resolveTheme` ignores the system value unless the
setting is `system`, so a subscribe/unsubscribe dance would buy nothing:

```ts
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    systemPrefersDark = media.matches
    const onSchemeChange = (e: MediaQueryListEvent | { matches: boolean }) => {
      systemPrefersDark = e.matches
      applyTheme(resolveTheme(themeSetting, systemPrefersDark))
    }
    media.addEventListener('change', onSchemeChange)
```

and return the cleanup alongside whatever `onMount` already returns:

```ts
    return () => media.removeEventListener('change', onSchemeChange)
```

If `onMount` currently returns nothing, add the return. If it already returns a
cleanup, call both.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd /Users/richarc/Development/hermes/frontend && npx vitest run src/App.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check && npm run build
cd /Users/richarc/Development/hermes && go test ./. && go build -o /dev/null .
```
Expected: 193 tests across 15 files; `0 ERRORS`; both builds succeed.

- [ ] **Step 6: Commit**

```bash
cd /Users/richarc/Development/hermes
git add frontend/src/App.svelte frontend/src/App.test.ts
git commit -m "$(cat <<'EOF'
feat: apply the theme from the persisted setting and the OS preference

App reads the setting at startup and on settings:changed, subscribes to
prefers-color-scheme, and applies the resolved theme. The media listener
stays attached regardless of the setting — resolveTheme ignores the system
value unless the setting is system, so a subscribe/unsubscribe dance would
buy nothing but one idle listener's worth of nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Record the shipped work

**Files:**
- Modify: `CHANGELOG.md`, `ROADMAP.md`, `CLAUDE.md` (repo root)

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` → `### Added`:

```markdown
- Dark theme, chosen from View → Appearance: System, Light, or Dark. System
  follows the OS appearance and changes with it. The choice is remembered
  between sessions. Charts keep a light background so figures stay readable
  and match the exported PDF, and PDF export is always light regardless of the
  app's appearance.
```

- [ ] **Step 2: Tick the roadmap item**

In `ROADMAP.md`, change the `## v0.5.0 — Dark theme` item from `- [ ]` to
`- [x]`.

- [ ] **Step 3: Note the palette convention in CLAUDE.md**

In the "Other things to know" list, add:

```markdown
- Colours live in one place: the custom-property palette at the top of `frontend/public/style.css`, with a `:root[data-theme="dark"]` block that must define exactly the same names. `src/lib/styleContract.test.ts` fails the build if a rule uses a literal colour or if the two blocks diverge. CodeMirror is themed through the same variables (`Editor.svelte`), so switching needs no reconfiguration. The dark `--bg` is duplicated in `main.go` as the window background because Go cannot read the CSS.
```

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/richarc/Development/hermes/frontend && npx vitest run && npm run check
cd /Users/richarc/Development/hermes && go test ./.
git add CHANGELOG.md ROADMAP.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: record the dark theme

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification summary

| After task | Frontend tests | Files |
|---|---|---|
| Baseline | 181 | 13 |
| 1 | 184 | 14 |
| 2 | 186 | 15 |
| 3 | 188 | 15 |
| 4 | 190 | 15 |
| 5 | 190 (Go +5) | 15 |
| 6 | 193 | 15 |
| 7 | 193 | 15 |

If a count comes out lower, a test was skipped rather than the arithmetic being
wrong — check before continuing.

## Manual check, once, at the end

jsdom has no cascade and no layout, so no automated test here can tell you the
theme *looks* right. After Task 6, run the app and confirm by eye:

```bash
cd /Users/richarc/Development/hermes && wails3 task run
```

1. **Both themes** — switch View → Appearance between Light and Dark. Chrome,
   toolbar, editor, preview, status bar and divider should all change together,
   with no light patch left behind.
2. **System** — set Appearance to System and flip the OS between light and dark
   in System Settings. The app should follow without a restart.
3. **A chart** — open `docs/sample-paper.md` in dark mode. The Vega chart should
   sit on a light card and be fully readable.
4. **Export a PDF from dark mode** — File → Export PDF… while the app is dark.
   **The PDF must be light**: black text on white, chart unchanged. This is the
   check most likely to catch a real defect, and the one no test covers.
5. **Launch flash** — quit and relaunch with Appearance set to Dark. The window
   should not flash white before the webview paints.
