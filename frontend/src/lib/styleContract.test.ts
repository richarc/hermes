import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CODE_TOKENS } from './syntaxTags'
import { PAGE_MARGIN_MM } from './paper'

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
    // The --sheet-* geometry is the one exception: lib/paper.ts's sheetStyle()
    // sets these as inline style on the .sheet element itself, so they never
    // appear as a declaration in style.css for paletteBlocks to find, even
    // though the rules that read them are entirely legitimate.
    const RUNTIME_VARIABLES = new Set([
      '--sheet-width',
      '--sheet-margin',
      '--sheet-margin-max',
    ])
    const used = new Set(
      [...CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]),
    )
    const defined = new Set(
      [...paletteBlocks(CSS).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    )
    const missing = [...used].filter((v) => !defined.has(v) && !RUNTIME_VARIABLES.has(v))
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

describe('code token styling', () => {
  it('gives every CODE_TOKENS role a preview rule pointing at its palette variable', () => {
    // syntaxTags.ts claims both panes derive from one list, but the preview
    // half is six hand-written CSS lines the type system cannot check. A role
    // added to CODE_TOKENS with no matching rule here would compile, pass
    // every test above, and render completely uncoloured.
    for (const role of CODE_TOKENS) {
      const variable = role.palette ?? role.name
      const re = new RegExp(
        `\\.sheet\\s+\\.tok-${role.name}\\s*\\{[^}]*color:\\s*var\\(--doc-syn-${variable}\\)`,
      )
      expect(CSS, `no sheet rule for tok-${role.name}`).toMatch(re)
    }
  })
})

function blockNames(css: string, selector: string): string[] {
  const start = css.indexOf(selector + ' {')
  if (start === -1) return []
  const end = css.indexOf('\n}', start)
  return [...css.slice(start, end).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
}

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
    // Built from PAGE_MARGIN_MM rather than written out, because 25mm exists
    // in three places — here, sheetStyle's two custom properties, and this
    // @page rule — and each side of the CSS/TS boundary was previously
    // guarded only against itself. A margin changed in paper.ts and not here
    // would have passed every test in the suite while the sheet and the PDF
    // quietly disagreed, which is the one failure this branch exists to
    // prevent.
    expect(print).toMatch(new RegExp(`@page\\s*\\{[^}]*margin: ${PAGE_MARGIN_MM}mm`))
  })
})

describe('sheet geometry', () => {
  it('caps the sheet\'s screen margin at the absolute page margin', () => {
    // The screen half of the same promise the @page assertion above makes.
    // Percentage padding resolves against the CONTAINING BLOCK — the preview
    // pane — never against the sheet's own min()-capped width, so the two
    // agree only while the pane is narrower than the paper. On a wider pane
    // the sheet stopped at 210mm and the percentage did not: a 1265px pane
    // (a 50/50 split on a 2560px display) drew ~39.7mm margins around a 496px
    // measure while the PDF used 605px, so line breaks, figure fit and chart
    // headroom on screen were not the ones in the export — and nothing looked
    // broken, because the sheet was still A4-shaped.
    //
    // min(percentage, absolute) is right in both regimes. A "simplification"
    // back to the bare percentage is the bug, and it fails here.
    //
    // Matched on the block that sets `width`, not simply the first `.sheet {`
    // in the file — that one is the document palette — so the declaration is
    // pinned to the rule where it actually applies.
    const geometry = [...stripComments(CSS).matchAll(/\.sheet \{[^}]*\}/g)]
      .map((m) => m[0])
      .filter((rule) => rule.includes('width: min(var(--sheet-width)'))
    expect(geometry).toHaveLength(1)
    expect(geometry[0]).toContain(
      'padding: min(var(--sheet-margin), var(--sheet-margin-max))',
    )
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
    // [^{:]* (not [^{]*) so this cannot be satisfied by button:disabled:hover
    // or any other button:disabled:<pseudo> rule — only the bare selector's
    // own declaration block, and specifically its opacity drop, counts.
    // Confirmed by mutation: with the old [^{]* pattern, deleting
    // `button:disabled { opacity: 0.45; cursor: default; }` outright still
    // passed as long as some `button:disabled:hover { ... }` rule existed.
    expect(css).toMatch(/button:disabled[^{:]*\{[^}]*opacity:/)
  })

  it('gives buttons a pressed state', () => {
    // Setting background and border suppresses the platform's own pressed
    // chrome, so it has to be put back explicitly — same reasoning as the
    // focus ring above. Scoped :not(:disabled) (see style.css), so the
    // selector is matched by substring rather than anchored to `button:active`
    // literally.
    expect(css).toMatch(/button:not\(:disabled\):active[^{]*\{[^}]*filter:/)
  })

  it('restores the margin the universal reset takes off the dialog', () => {
    // A native <dialog> centres itself through the UA stylesheet's
    // `margin: auto` against `inset: 0`. This file opens with
    // `* { margin: 0 }`, and an AUTHOR rule beats the user-agent origin
    // whatever its specificity — so without an explicit `margin: auto` here
    // the dialog collapses to its inset origin in the top-left corner, where
    // its content lands under the traffic lights. Shipped exactly that way
    // once; jsdom has no layout engine, so this assertion is the only guard.
    const dialogRule = stripComments(CSS).match(/\bdialog\s*\{[^}]*\}/)
    expect(dialogRule).not.toBeNull()
    expect(dialogRule![0]).toMatch(/margin:\s*auto/)
  })

  it('keeps the dialog footer visible when the body scrolls', () => {
    // The branch's headline UX fix: a large pasted table used to scroll
    // Insert chart out of sight along with the rest of the dialog body.
    expect(css).toMatch(/\.modal-buttons[^{]*\{[^}]*position: sticky/)
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
