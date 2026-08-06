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
