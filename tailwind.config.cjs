const themeConfig = require('./src/config/theme.config.json')

const colorVar = (name) => `rgb(var(--color-${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: colorVar('primary'),
        secondary: colorVar('secondary'),
        accent: colorVar('accent'),
        background: colorVar('background'),
        card: colorVar('card'),
        border: colorVar('border'),
        text: colorVar('text'),
      },
      boxShadow: {
        panel: '0 24px 80px rgb(15 23 42 / 0.16)',
      },
      fontFamily: {
        sans: themeConfig.fonts.sans,
        mono: themeConfig.fonts.mono,
      },
    },
  },
  plugins: [],
}
