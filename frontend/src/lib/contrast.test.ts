import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS = readFileSync(
  join(fileURLToPath(import.meta.url), '../../../public/style.css'),
  'utf8',
)

/** Pulls the custom properties out of one selector's block. */
function palette(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector + ' {')
  if (start === -1) throw new Error(`no block for ${selector}`)
  const end = CSS.indexOf('\n}', start)
  const out: Record<string, string> = {}
  for (const m of CSS.slice(start, end).matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    out[m[1]] = m[2].trim()
  }
  return out
}

function relativeLuminance(colour: string): number {
  let h = colour.replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

/** Every text pair, with the target its role demands. */
const PAIRS: Array<[label: string, fg: string, bg: string, target: number]> = [
  ['body text', '--fg', '--bg', 7],
  ['status bar', '--muted', '--bg', 4.5],
  ['blockquote', '--muted-strong', '--bg', 4.5],
  ['link', '--link', '--bg', 4.5],
  ['toast', '--toast-fg', '--toast-bg', 4.5],
  ['chart error', '--chart-error-fg', '--chart-error-bg', 4.5],
  ['cite error', '--cite-error-fg', '--cite-error-bg', 4.5],
  ['editor text', '--editor-fg', '--editor-bg', 7],
  ['gutter numbers', '--editor-gutter-fg', '--editor-gutter-bg', 4.5],
  ['syntax heading', '--syn-heading', '--editor-bg', 4.5],
  ['syntax emphasis', '--syn-emphasis', '--editor-bg', 4.5],
  ['syntax code', '--syn-code', '--editor-bg', 4.5],
  ['syntax link', '--syn-link', '--editor-bg', 4.5],
  ['syntax quote', '--syn-quote', '--editor-bg', 4.5],
  ['syntax meta', '--syn-meta', '--editor-bg', 4.5],
]

function check(selector: string) {
  const p = palette(selector)
  const failures: string[] = []
  for (const [label, fgVar, bgVar, target] of PAIRS) {
    const ratio = contrast(p[fgVar], p[bgVar])
    if (ratio < target) {
      failures.push(`${label}: ${ratio.toFixed(2)}:1 (needs ${target}:1)`)
    }
  }
  return failures
}

describe('palette contrast', () => {
  // Colours stay verified rather than eyeballed. A future tweak that drops a
  // pair below its target fails here instead of shipping.
  it('meets every target in the light palette', () => {
    expect(check(':root')).toEqual([])
  })

  it('meets every target in the dark palette', () => {
    expect(check(':root[data-theme="dark"]')).toEqual([])
  })
})
