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
