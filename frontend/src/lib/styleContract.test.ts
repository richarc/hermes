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
    const literals = ruleBody(CSS).match(LITERAL_COLOUR) ?? []
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
})
