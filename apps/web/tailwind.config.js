/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: '#070a0f',
          900: '#0b0f17',
          850: '#0e141f',
          800: '#131924',
          750: '#182130',
          700: '#1f2b3e',
          600: '#2d3d56',
          500: '#475b7a',
          400: '#758aa8',
          300: '#a3b4cc',
          200: '#d1dbed',
          100: '#eef2f9'
        },
        signal: {
          lime: '#a3e635',
          emerald: '#10b981',
          teal: '#14b8a6',
          salmon: '#fb7185',
          coral: '#f87171',
          amber: '#fbbf24',
          cyan: '#38bdf8'
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['"Space Grotesk"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'brutal-lime': '3px 3px 0px 0px rgba(163, 230, 53, 0.9)',
        'brutal-salmon': '3px 3px 0px 0px rgba(251, 113, 133, 0.9)',
        'brutal-dark': '3px 3px 0px 0px rgba(0, 0, 0, 0.8)',
        'brutal-sm': '2px 2px 0px 0px rgba(0, 0, 0, 0.9)',
      }
    },
  },
  plugins: [],
};
