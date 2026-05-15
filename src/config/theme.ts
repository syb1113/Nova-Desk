import themeConfig from './theme.config.json'

export type ThemeMode = keyof typeof themeConfig.modes
export type ThemeToken = keyof (typeof themeConfig.modes)['light']

export const theme = themeConfig

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)

  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`
}

export const applyTheme = (mode: ThemeMode) => {
  const root = document.documentElement
  const palette = themeConfig.modes[mode]

  root.dataset.theme = mode
  root.classList.toggle('dark', mode === 'dark')

  Object.entries(palette).forEach(([name, value]) => {
    root.style.setProperty(`--color-${name}`, hexToRgb(value))
    root.style.setProperty(`--hex-${name}`, value)
  })
}
