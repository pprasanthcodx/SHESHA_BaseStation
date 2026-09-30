/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0B0D13',
        panel: '#151923',
        panel_light: '#1F2433',
        cyan_telemetry: '#00E5FF',
        status_stable: '#00C853',
        status_watch: '#FFAB00',
        status_critical: '#DD2C00',
        text_main: '#E0E0E0',
        text_muted: '#9E9E9E'
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        'sm': '4px',
        DEFAULT: '4px',
        'md': '6px',
        'lg': '6px',
      }
    },
  },
  plugins: [],
}
