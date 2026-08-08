import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS = readFileSync(
  join(fileURLToPath(import.meta.url), '../../../public/style.css'),
  'utf8',
)

// Editor.svelte's hermesTheme reads palette variables through CodeMirror's
// EditorView.theme(), never from a stylesheet rule, so it is invisible to
// every check above that only reads style.css. A name renamed in style.css
// but not here (or vice versa) would still pass every one of those and only
// show up as CodeMirror silently falling back to its own base-theme colour.
const EDITOR_SVELTE = readFileSync(
  join(fileURLToPath(import.meta.url), '../../Editor.svelte'),
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

/** Strips CSS comments before the literal-colour hunt. Explanatory prose is
 *  free to say "black", "pink", "avoid a stark white flash" — those are
 *  colour *words*, not colour *declarations*, and the guard below exists to
 *  catch the latter. Without this, ordinary English trips an unrelated test
 *  in a file most contributors don't know exists. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

// The CSS Color Module Level 4 named colours. A contributor reaching for a
// quick colour is just as likely to type `white` or `firebrick` as `#fff` —
// this list closes that gap so bare keywords are caught too.
//
// `transparent` and `currentColor` are deliberately NOT in this list: they
// are not colour choices, they're keywords that defer to context (paint
// nothing, or inherit whatever foreground the theme already picked). Do not
// add them back in.
const NAMED_COLOURS = [
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue',
  'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
  'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon',
  'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick',
  'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod',
  'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred', 'indigo',
  'ivory', 'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue',
  'lightcoral', 'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey',
  'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray',
  'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen',
  'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
  'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
  'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite',
  'navy', 'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod',
  'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink',
  'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue',
  'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver',
  'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue',
  'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white', 'whitesmoke',
  'yellow', 'yellowgreen',
]

const LITERAL_COLOUR = new RegExp(
  `#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]*\\)|\\b(?:${NAMED_COLOURS.join('|')})\\b`,
  'gi',
)

describe('style.css palette contract', () => {
  it('declares no literal colours outside the palette', () => {
    // Colours are decided in one place. A literal here means a rule that
    // cannot follow the theme — the exact way a half-dark UI ships.
    const literals = ruleBody(stripComments(CSS)).match(LITERAL_COLOUR) ?? []
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

  it('defines every variable Editor.svelte reads for the CodeMirror theme', () => {
    // hermesTheme's rules live in a JS object, not a stylesheet rule, so they
    // are outside every other check here. A variable renamed in style.css
    // only (e.g. --editor-selection -> --editor-select) would leave this the
    // sole place that would still notice — CodeMirror falls back to its own
    // base-theme colour, silently, in dark mode only.
    const used = new Set(
      [...EDITOR_SVELTE.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]),
    )
    const defined = new Set(
      [...paletteBlocks(CSS).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    )
    const missing = [...used].filter((v) => !defined.has(v))
    expect(missing).toEqual([])
  })
})

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

  it('forces a light palette back for print', () => {
    const print = CSS.slice(CSS.indexOf('@media print'))
    expect(print).toContain(':root[data-theme="dark"]')
    expect(print).toContain('--fg:')
    expect(print).toContain('--bg:')
    expect(print).toContain('--figure-bg:')
  })

  it('declares exactly the same variables in print as light and dark', () => {
    // The print block is a *third* palette, not a footnote on the dark one:
    // data-theme="dark" is still on the root when printing, so any variable
    // the print block omits falls through to the dark block's value instead
    // of print's. A name missing here passes every other check — parity
    // between light and dark, no literal colours — and only shows up as a
    // dark-mode PDF export with (for example) near-white headings on paper.
    // The print selector is the comma-joined `:root, :root[data-theme="dark"]`
    // inside `@media print`; match that exact selector so this reads the
    // print block and not the standalone dark block above it.
    const light = blockNames(CSS, ':root')
    const print = blockNames(CSS, ':root, :root[data-theme="dark"]')
    expect([...print].sort()).toEqual([...light].sort())
  })
})

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
    // Comments are stripped first: the rules this guards sit right after a
    // large explanatory comment block, and an uncommented selector there
    // would make this pass even if the actual rule went missing.
    const css = stripComments(CSS)
    for (const value of ['left', 'center', 'right']) {
      expect(css).toContain(`[data-figure-align="${value}"]`)
    }
  })

  it('keeps a caption on the same page as its figure when printing', () => {
    // Without this a caption orphans onto the next page — a failure the
    // in-SVG title did not have.
    const print = CSS.slice(CSS.indexOf('@media print'))
    expect(print).toMatch(/figure[^{]*\{[^}]*break-inside: avoid/)
  })
})

describe('control styling', () => {
  const css = stripComments(CSS)

  it('gives every button a focus-visible ring, not just the browser default', () => {
    // Styling a control removes the UA ring. Losing it is invisible in every
    // automated check and obvious only to someone navigating by keyboard.
    expect(css).toMatch(/button:focus-visible[^{]*\{[^}]*outline:/)
  })

  it('gives the pane divider a focus ring too', () => {
    // .divider carries tabindex="0" for the WAI-ARIA splitter pattern, so it
    // is a focus stop that is not a control and would otherwise be missed.
    expect(css).toMatch(/\.divider:focus-visible[^{]*\{[^}]*outline:/)
  })

  it('styles disabled buttons', () => {
    expect(css).toMatch(/button:disabled[^{]*\{/)
  })

  it('gives buttons a pressed state', () => {
    // Setting background and border suppresses the platform's own pressed
    // chrome, so it has to be put back explicitly — same reasoning as the
    // focus ring above.
    expect(css).toMatch(/button:active[^{]*\{[^}]*filter:/)
  })

  it('no longer carries the one-off welcome button rule', () => {
    // Promoted to the base button style; a survivor would silently win on
    // specificity and keep the welcome pane looking different from the rest.
    // A word boundary (rather than a plain substring match) so this does not
    // false-positive on the surviving .welcome-actions layout wrapper, which
    // starts with the same characters but is a different class.
    expect(css).not.toMatch(/\bwelcome-action\b/)
  })
})
