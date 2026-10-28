/** @type {import('tailwindcss').Config} */
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'), surface: c('surface'), raised: c('raised'), line: c('line'),
        ink: c('ink'), muted: c('muted'), brand: c('brand'), accent: c('accent'),
        danger: c('danger'), ok: c('ok'),
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: { glow: '0 10px 40px -10px rgb(var(--brand) / 0.55)' },
      keyframes: {
        pulseRing: { '0%': { transform: 'scale(1)', opacity: '0.5' }, '100%': { transform: 'scale(1.9)', opacity: '0' } },
        rise: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: { pulseRing: 'pulseRing 2s ease-out infinite', rise: 'rise .5s ease-out both' },
    },
  },
  plugins: [],
};
