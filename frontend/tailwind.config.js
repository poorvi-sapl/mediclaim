/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
          950: '#0A302E',
        },
        navy: {
          50:  '#F1F5FB',
          100: '#DCE5F2',
          200: '#B7C5DD',
          300: '#8499BD',
          400: '#566D97',
          500: '#324B78',
          600: '#22386A',
          700: '#162A55',
          800: '#0E1F44',
          900: '#0A1933',
          950: '#06122A',
        },
        dark: {
          900: '#000000',
          800: '#070708',
          700: '#0a0a0c',
          600: '#0f0f12',
          500: '#141418',
          400: '#1c1c22',
          300: '#26262e',
        },
        // Vendor portal theme (navy / steel-blue / beige / cream) — rolling out
        // across the vendor portal starting with the dashboard KPI cards.
        vendorNavy:  '#213555',
        vendorSteel: '#3E5879',
        vendorBeige: '#D8C4B6',
        vendorCream: '#F5EFE7',
        // MedClaim Analytics light theme
        sidebar: '#1B3A5C',
        ink: {
          DEFAULT: '#1B3A5C',
          600: '#1B3A5C',
          700: '#15304c',
          800: '#102338',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['"Inter Tight"', 'Inter', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'card':         '0 1px 0 0 rgba(255,255,255,0.04)',
        'card-hover':   '0 8px 32px -8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)',
        'card-raised':  '0 4px 16px -4px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.07)',
        'brand-glow':   '0 0 0 1px rgba(13, 148, 136, 0.3), 0 8px 24px -8px rgba(13, 148, 136, 0.4)',
        'teal-glow':    '0 0 0 1px rgba(45,212,191,0.2), 0 0 24px -4px rgba(45,212,191,0.12)',
        'blue-glow':    '0 0 0 1px rgba(37,99,235,0.4), 0 8px 24px -8px rgba(37,99,235,0.3)',
        'inner-line':   'inset 0 -1px 0 0 rgba(255,255,255,0.04)',
      },
      backgroundImage: {
        'brand-gradient':   'linear-gradient(135deg, #0D9488 0%, #14B8A6 100%)',
        'navy-gradient':    'linear-gradient(180deg, #000000 0%, #000000 100%)',
        'sidebar-gradient': 'linear-gradient(180deg, #000000 0%, #070708 100%)',
        'hero-radial':      'radial-gradient(ellipse 80% 80% at 80% 50%, rgba(13,148,136,0.06) 0%, transparent 65%)',
        'teal-radial':      'radial-gradient(ellipse 60% 60% at 20% 80%, rgba(13,148,136,0.05) 0%, transparent 60%)',
        'subtle-noise':     'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0)',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.55' },
        },
        'fade-in-up': {
          'from': { opacity: '0', transform: 'translateY(6px)' },
          'to':   { opacity: '1', transform: 'translateY(0)' },
        },
        'shimmer': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
        'fade-in-up': 'fade-in-up 0.3s ease-out',
        'shimmer':    'shimmer 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
