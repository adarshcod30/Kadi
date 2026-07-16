/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Palette taken from the official Karnataka State Police site
      // (ksp.karnataka.gov.in): #0f2f44 navy-teal chrome + #ffc712 gold accent +
      // #183883 deep blue. Gold is only ever used on dark surfaces (as KSP do) —
      // it fails contrast on white.
      colors: {
        kadi: {
          navy: '#0f2f44', navy700: '#0a2231', deep: '#183883',
          blue: '#1A6FC4', blue50: '#EAF3FB',
          gold: '#ffc712', saffron: '#E8871E', teal: '#2FA8A0',
        },
        surface: { DEFAULT: '#FFFFFF', 2: '#F7F9FB', 3: '#EDF1F6' },
        ink: { DEFAULT: '#1C2A3A', muted: '#5B6B7E' },
        line: '#D9E1EC',
        success: '#1E874B', warning: '#C9820A', danger: '#C0392B',
        heinous: '#C0392B', nonheinous: '#5B6B7E',
      },
      fontFamily: {
        sans: ['"Open Sans"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        heading: ['Ubuntu', '"Open Sans"', 'system-ui', 'sans-serif'],
        kn: ['"Noto Sans Kannada"', '"Open Sans"', 'sans-serif'],
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
