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
