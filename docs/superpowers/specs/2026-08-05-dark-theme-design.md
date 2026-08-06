# Hermes v0.5 — Dark Theme: Design

**Date:** 2026-08-05
**Status:** Approved design, pending implementation plan

## Overview

A dark theme covering the app chrome, the preview, the editor, and the window
itself. v0.1 deliberately pinned a light scheme; this undoes that pin and makes
the choice explicit and persisted.

The pre-v0.4 review (finding A4) scoped this as touching four layers, and named
the least obvious one: the print stylesheet, which must keep rendering light or
exported PDFs come out dark.

## The choices

### Theme selection — System / Light / Dark

| Option | Verdict |
|---|---|
| **A — Three radios in View → Appearance** | **Chosen** |
| B — A single "Dark Mode" checkbox | Rejected |
| C — Follow the system only, no setting | Rejected |

A matches the macOS convention and the precedent already set by File → PDF
Orientation. **System** follows the OS appearance live, so the app darkens at
sunset along with everything else; it costs one `prefers-color-scheme` media
query listener over B.

B was rejected because a user who wants the app to track the OS has to toggle
it by hand twice a day. C was rejected because someone writing in a dark room
on a light OS — or wanting a light editor while proofreading a paper destined
for print — has no way to say so.

The View menu already exists, created by the v0.4 scroll-sync work.

### The preview and its figures — dark preview, light chart cards

| Option | Verdict |
|---|---|
| **A — Dark preview, charts on explicit light cards** | **Chosen** |
| B — Dark preview, charts re-themed dark | Rejected |
| C — Preview stays light always | Rejected |

Vega draws axes, labels and gridlines in dark tones on a transparent ground, so
on a dark page an unstyled chart is close to invisible. A light card — the way a
figure sits on a page — fixes that and buys two further things: charts render
identically in the preview and in the exported PDF, and **the hydrator's cache
stays valid across a theme change**.

That last point decided it. `charts.ts` caches rendered charts keyed by spec
text, and the theme is not part of that key. Re-theming charts (option B) would
mean invalidating and re-embedding every cached chart on a theme change —
new machinery, and the same staleness class of bug that had to be fixed for
`data-source-line` anchors in v0.4. Option A never re-themes a chart, so the
question does not arise.

C was rejected because a large bright panel beside a dark editor is what dark
mode exists to avoid, and the preview is half the window.

### The editor's theme — hand-rolled, sharing the app palette

| Option | Verdict |
|---|---|
| **A — `EditorView.theme` + `HighlightStyle` using CSS variables** | **Chosen** |
| B — Add `@codemirror/theme-one-dark` | Rejected |

Hermes is a writing tool: its highlighting is modest — headings, emphasis,
code, links, frontmatter — so the syntax palette to choose is small. B works
immediately but its blue-grey palette is designed for a code editor and cannot
be aligned to the app's; it would read as a code pane bolted into a writing
app. The palette work has to happen for the other 26 colours regardless.

## The palette itself

The v0.1 light scheme — `#000000` on `#ffffff` — was a default rather than a
decision, and nothing since had examined it. Both screen palettes are therefore
chosen here against stated targets, and measured.

**Screen and paper deliberately differ.** Pure black on white is 21:1, the
theoretical maximum, and is a known source of glare over a long reading
session; white-on-black at high contrast causes halation in the other
direction. But ink on paper does not glare, and black-on-white is the academic
convention — so the print palette keeps pure black on white while both screen
palettes are softened. The design already forces a separate palette for print,
so this costs nothing structurally.

### Targets

| Role | Target |
|---|---|
| Body text (document and editor) | ≥ 7:1 (WCAG AAA) |
| Secondary text — status bar, blockquote, errors, links, syntax | ≥ 4.5:1 (AA) |
| Editor gutter line numbers | ≥ 4.5:1 |

Non-text values — borders, dividers, surfaces, selection tints — carry no
contrast target; they are chosen to sit consistently against their background.

### Measured result

Every text pair in both palettes was computed and meets its target. The
headline values:

| | Light screen | Dark screen | Print |
|---|---|---|---|
| Background | `#fcfcfc` | `#1f1f1f` | `#ffffff` |
| Body text | `#1a1a1a` (17.0:1) | `#d0d0d0` (10.7:1) | `#000000` (21.0:1) |
| Secondary | `#5e5e5e` (6.3:1) | `#9c9c9c` (6.0:1) | `#666666` |
| Link | `#0b57c2` (6.5:1) | `#7cb0ff` (7.5:1) | `#0b62d6` |
| Gutter numbers | `#5c5c5c` (6.1:1) | `#8f8f8f` (4.8:1) | — |

The previous draft's weakest value was the dark editor gutter at 3.1:1, below
AA; it is now 4.8:1.

The full values live in the implementation plan, and a test computes every pair
and fails the build if one drops below its target — so the palette stays
verified rather than becoming eyeballed again the next time a colour is
touched.

## Architecture

### One palette, in CSS custom properties

`public/style.css` defines the light palette on `:root` and overrides it under
`:root[data-theme="dark"]`. All 26 currently-hardcoded colours become
`var(--…)`. Everything downstream — chrome, preview, editor, print — reads
those same variables, so a colour is decided in exactly one place.

`:root { color-scheme: light }` becomes theme-dependent, so native scrollbars
and form controls follow.

### Resolving the setting

`lib/theme.ts`, split into a pure part and a DOM part the way `scrollSync.ts`
is:

```ts
export type ThemeSetting = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export function resolveTheme(
  setting: ThemeSetting,
  systemPrefersDark: boolean,
): ResolvedTheme

export function applyTheme(resolved: ResolvedTheme): void  // sets data-theme on <html>
```

`applyTheme` always *sets* `data-theme`, to `"light"` or `"dark"` — it never
removes the attribute. The light palette therefore lives on `:root` as the
default and is also what `[data-theme="light"]` selects, so a document is never
momentarily unstyled while switching.

`App.svelte` reads the setting on mount and on the existing `settings:changed`
event, and subscribes to `matchMedia('(prefers-color-scheme: dark)')` in
`onMount`, unsubscribing in the returned cleanup. It re-applies when either
input changes. The listener stays attached regardless of the setting;
`resolveTheme` ignores the system value unless the setting is `system`. The
alternative — a subscribe/unsubscribe dance keyed on the setting — buys nothing
but one idle listener's worth of nothing.

### The editor, without reconfiguration

**Verified by spike before adoption.** CodeMirror themes are static extensions,
so the conventional way to switch them is a `Compartment` and a reconfiguration
dispatch. That is not needed here: `EditorView.theme()` and
`HighlightStyle.define()` both emit ordinary CSS, and `var(--…)` values survive
into the generated stylesheet intact. Theme switching for the editor is
therefore pure CSS, like everything else.

Two things the spike established, both of which had to hold:

- **`dark: true` is unnecessary.** It only adds a class that base-theme rules
  written as `&dark` / `&light` key off. Omitting it leaves the editor on the
  `&light` base rules permanently, which is fine because our own theme
  overrides every one that matters: `.cm-content`, `.cm-selectionBackground`,
  `.cm-cursor`, `.cm-activeLine`, `.cm-gutters`, `.cm-activeLineGutter`.
- **Our rules actually win, and it is a precedence guarantee, not accidental
  order.** `EditorView.baseTheme` wraps its style module in `Prec.lowest`, and
  `mountStyles` mounts base themes first by contract, so an ordinary
  `EditorView.theme()` like ours always lands after it. `&light` does *not*
  compile to a single class — it compiles to `.ͼ2 .cm-selectionBackground`,
  two classes, the same as ours — so the two have equal specificity and this
  precedence guarantee, not source order, is what decides the tie in our
  favour.

**Recorded risk:** the live residual risk is not a future CodeMirror raising
base-theme specificity — the precedence guarantee makes that a non-issue. It
is a future extension listed *after* `hermesTheme` in the extensions array
that itself calls `EditorView.theme()`; that would land after ours at equal
precedence and win. The symptom would be a light selection highlight in dark
mode rather than any error. This warrants a comment at the theme definition so
the failure is diagnosable.

### Charts

`.vega-lite-chart` gets an explicit light card in dark mode — background,
padding, rounded corner. `.chart-error` and `.cite-error` currently use
light-red backgrounds and sit on the same logic.

No Vega configuration, no re-embedding, no cache invalidation.

### Print stays light, always

The `@media print` block re-declares the light palette values, so an exported
PDF is light regardless of the app's appearance. Without this, a dark-mode user
exports a PDF whose text is near-white: browsers drop background colours when
printing by default but honour text colour, so the failure is invisible on
screen and total on paper.

### Go side

`Settings` gains `Theme string`, default `"system"`. Unlike `SyncScrolling`,
this one **does** need a `normalise` clamp — only three values are legal.

`menu.go` gains a View → Appearance submenu with three radios, following the
PDF Orientation pattern already in that file.

`main.go`'s hardcoded `BackgroundColour: NewRGB(255, 255, 255)` becomes
dependent on the persisted setting: `light` → white, `dark` → the dark
background, `system` → white.

**One value lives in two places.** Go cannot read the CSS, so the dark
background colour is written once in `style.css` as the `--bg` dark override
and again in `main.go` as an `NewRGB` triple. They must match, and nothing
enforces it. Both sites need a comment naming the other, and the plan should
put them in the same task so they are chosen together rather than drifting
apart later.

**Known limitation, accepted deliberately.** The window background is what
shows for the moment before the webview paints. Go can read the persisted
setting directly for `light` and `dark`, but for `system` it would need the OS
appearance, which means cgo (`NSApp.effectiveAppearance`). That was cut as
disproportionate: it affects a brief flash at launch, nothing else. So a
`system` user on a dark OS keeps today's white flash — unchanged from current
behaviour, while the other two cases improve. If it ever irritates, the fix is
a small `theme_darwin.go` / `theme_other.go` pair mirroring the cgo pattern
`print_darwin.go` already establishes.

## Components

| File | Change |
|---|---|
| `frontend/public/style.css` | Palette variables; all 26 colours via `var()`; dark overrides; chart cards; print block re-declares light |
| `frontend/src/lib/theme.ts` (new) | `resolveTheme` (pure) and `applyTheme` (DOM) |
| `frontend/src/lib/theme.test.ts` (new) | The six `resolveTheme` cases |
| `frontend/src/Editor.svelte` | Theme extension + `HighlightStyle`, both in `var()` |
| `frontend/src/App.svelte` | Read setting, subscribe to the media query, apply |
| `frontend/src/App.test.ts` | Component coverage (below) |
| `settings.go`, `settings_test.go` | `Theme` field, default, `normalise` clamp |
| `menu.go` | View → Appearance radios |
| `main.go` | Window background from the setting |

## Error handling

Nothing here can fail in a way worth surfacing. An unrecognised persisted value
normalises to `system`. A missing `matchMedia` (it exists in every target
webview) would leave the system branch resolving to light. A failed settings
write is logged, as with the other preferences.

## Testing

**`theme.test.ts`** — `resolveTheme` across all six combinations: each of the
three settings against `systemPrefersDark` true and false. Explicit and
exhaustive, because this is the whole decision surface.

**Go** — the `Theme` round-trip, the default, and that `normalise` clamps an
unrecognised value to `system`. Also that changing `Theme` leaves
`PrintOrientation` and `SyncScrolling` untouched, matching the existing
independence test.

**Component tests** — `data-theme` lands on the root element; it changes when
the setting changes; and it follows the media query **only** when the setting
is `system`. That last case is the one most likely to regress and the one worth
the most care.

**Not automated.** The actual colours, the contrast, the chart cards, and the
print output are a manual check — there is no honest way to assert "looks
right" in jsdom, which has no layout or cascade. The plan should carry an
explicit manual checklist: both themes, a document with a chart, and an
exported PDF from dark mode confirmed to be light.
