// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fitDisplayMath, MIN_FIT } from './fitMath'

// jsdom has no layout, so each formula's two widths are stubbed. The natural
// width is read after the factor is cleared, which is what the stub stands for.
function display(available: number, natural: number): HTMLElement {
  const d = document.createElement('span')
  d.className = 'katex-display'
  const k = document.createElement('span')
  k.className = 'katex'
  Object.defineProperty(k, 'clientWidth', { value: available, configurable: true })
  Object.defineProperty(k, 'scrollWidth', { value: natural, configurable: true })
  d.appendChild(k)
  return d
}

function sheetWith(...displays: HTMLElement[]): HTMLElement {
  const sheet = document.createElement('div')
  for (const d of displays) sheet.appendChild(d)
  return sheet
}

const fit = (d: HTMLElement) => d.style.getPropertyValue('--math-fit')

describe('fitDisplayMath', () => {
  it('leaves a formula that fits alone', () => {
    const d = display(500, 400)
    fitDisplayMath(sheetWith(d))
    expect(fit(d)).toBe('')
  })

  it('scales a formula wider than the sheet down to fit', () => {
    const d = display(400, 800)
    fitDisplayMath(sheetWith(d))
    expect(fit(d)).toBe('0.5')
  })

  it('rounds the factor down, so the result never overshoots', () => {
    const d = display(400, 600)
    fitDisplayMath(sheetWith(d))
    expect(fit(d)).toBe('0.666')
  })

  it('stops at the minimum factor rather than shrinking past legibility', () => {
    const d = display(100, 1000)
    fitDisplayMath(sheetWith(d))
    expect(fit(d)).toBe(String(MIN_FIT))
  })

  it('clears a stale factor once the formula fits again', () => {
    const d = display(800, 600)
    d.style.setProperty('--math-fit', '0.5')
    fitDisplayMath(sheetWith(d))
    expect(fit(d)).toBe('')
  })

  it('fits each formula independently', () => {
    const wide = display(400, 800)
    const narrow = display(400, 200)
    fitDisplayMath(sheetWith(wide, narrow))
    expect(fit(wide)).toBe('0.5')
    expect(fit(narrow)).toBe('')
  })

  it('does nothing for a formula that has not been laid out', () => {
    const d = display(0, 300)
    fitDisplayMath(sheetWith(d))
    expect(fit(d)).toBe('')
  })
})
