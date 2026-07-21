export const THEMES = ['dark', 'light', 'business', 'christmas', 'anime', 'forest', 'ocean'] as const
export type Theme = (typeof THEMES)[number]

/** Representative swatches for the Settings picker: [page bg, accent]. */
export const THEME_SWATCH: Record<Theme, [string, string]> = {
  dark: ['#020617', '#6366f1'],
  light: ['#eef2f7', '#6366f1'],
  business: ['#f4f5f7', '#1e4a7a'],
  christmas: ['#0a1810', '#c02626'],
  anime: ['#120d1d', '#ec4899'],
  forest: ['#eef3d5', '#9a5730'],
  ocean: ['#06131f', '#0891b2'],
}

export function applyTheme(theme: Theme) {
  if (theme === 'dark') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)
}

export function currentTheme(): Theme {
  const saved = localStorage.getItem('theme') as Theme | null
  return saved && THEMES.includes(saved) ? saved : 'dark'
}

export function initTheme() {
  applyTheme(currentTheme())
}
