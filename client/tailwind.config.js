/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        kadi: {
          navy: '#0B3D75', navy700: '#12305C', blue: '#1A6FC4', blue50: '#EAF3FB',
          saffron: '#E8871E', teal: '#2FA8A0',
        },
        surface: { DEFAULT: '#FFFFFF', 2: '#F5F7FA', 3: '#EDF1F6' },
        ink: { DEFAULT: '#1C2A3A', muted: '#5B6B7E' },
        line: '#D9E1EC',
        success: '#1E874B', warning: '#C9820A', danger: '#C0392B',
        heinous: '#C0392B', nonheinous: '#5B6B7E',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        kn: ['"Noto Sans Kannada"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { card: '8px', ctl: '6px' },
      boxShadow: {
        card: '0 1px 2px rgba(16,40,70,.06)',
        hover: '0 4px 12px rgba(16,40,70,.10)',
      },
    },
  },
  plugins: [],
};
