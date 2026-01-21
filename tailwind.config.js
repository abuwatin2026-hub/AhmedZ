/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./index.tsx",
    "./App.tsx",
    "./screens/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Primary Green Colors (قاتي - Qati)
        primary: {
          50: 'rgb(var(--color-primary-50) / <alpha-value>)',
          100: 'rgb(var(--color-primary-100) / <alpha-value>)',
          200: 'rgb(var(--color-primary-200) / <alpha-value>)',
          300: 'rgb(var(--color-primary-300) / <alpha-value>)',
          400: 'rgb(var(--color-primary-400) / <alpha-value>)',
          500: 'rgb(var(--color-primary-500) / <alpha-value>)',
          600: 'rgb(var(--color-primary-600) / <alpha-value>)',
          700: 'rgb(var(--color-primary-700) / <alpha-value>)',
          800: 'rgb(var(--color-primary-800) / <alpha-value>)',
          900: 'rgb(var(--color-primary-900) / <alpha-value>)',
          950: 'rgb(var(--color-primary-950) / <alpha-value>)',
        },
        green: {
          50: 'rgb(var(--color-primary-50) / <alpha-value>)',
          100: 'rgb(var(--color-primary-100) / <alpha-value>)',
          200: 'rgb(var(--color-primary-200) / <alpha-value>)',
          300: 'rgb(var(--color-primary-300) / <alpha-value>)',
          400: 'rgb(var(--color-primary-400) / <alpha-value>)',
          500: 'rgb(var(--color-primary-500) / <alpha-value>)',
          600: 'rgb(var(--color-primary-600) / <alpha-value>)',
          700: 'rgb(var(--color-primary-700) / <alpha-value>)',
          800: 'rgb(var(--color-primary-800) / <alpha-value>)',
          900: 'rgb(var(--color-primary-900) / <alpha-value>)',
          950: 'rgb(var(--color-primary-950) / <alpha-value>)',
        },
        // Light Green Colors (أخضر فاتح)
        mint: {
          50: 'rgb(var(--color-mint-50) / <alpha-value>)',
          100: 'rgb(var(--color-mint-100) / <alpha-value>)',
          200: 'rgb(var(--color-mint-200) / <alpha-value>)',
          300: 'rgb(var(--color-mint-300) / <alpha-value>)',
          400: 'rgb(var(--color-mint-400) / <alpha-value>)',
          500: 'rgb(var(--color-mint-500) / <alpha-value>)',
          600: 'rgb(var(--color-mint-600) / <alpha-value>)',
          700: 'rgb(var(--color-mint-700) / <alpha-value>)',
          800: 'rgb(var(--color-mint-800) / <alpha-value>)',
          900: 'rgb(var(--color-mint-900) / <alpha-value>)',
        },
        // Gold/Golden Colors (الذهبي)
        gold: {
          50: 'rgb(var(--color-gold-50) / <alpha-value>)',
          100: 'rgb(var(--color-gold-100) / <alpha-value>)',
          200: 'rgb(var(--color-gold-200) / <alpha-value>)',
          300: 'rgb(var(--color-gold-300) / <alpha-value>)',
          400: 'rgb(var(--color-gold-400) / <alpha-value>)',
          500: 'rgb(var(--color-gold-500) / <alpha-value>)',
          600: 'rgb(var(--color-gold-600) / <alpha-value>)',
          700: 'rgb(var(--color-gold-700) / <alpha-value>)',
          800: 'rgb(var(--color-gold-800) / <alpha-value>)',
          900: 'rgb(var(--color-gold-900) / <alpha-value>)',
        },
        // Accent Colors
        accent: {
          teal: 'rgb(var(--color-primary-500) / <alpha-value>)',
          mint: 'rgb(var(--color-mint-500) / <alpha-value>)',
          gold: 'rgb(var(--color-gold-500) / <alpha-value>)',
          lightGold: 'rgb(var(--color-gold-200) / <alpha-value>)',
          darkTeal: 'rgb(var(--color-primary-900) / <alpha-value>)',
          cream: 'rgb(var(--color-primary-50) / <alpha-value>)',
        },
        // Keep orange for backward compatibility but map to Green
        orange: {
          50: 'rgb(var(--color-primary-50) / <alpha-value>)',
          100: 'rgb(var(--color-primary-100) / <alpha-value>)',
          200: 'rgb(var(--color-primary-200) / <alpha-value>)',
          300: 'rgb(var(--color-primary-300) / <alpha-value>)',
          400: 'rgb(var(--color-primary-400) / <alpha-value>)',
          500: 'rgb(var(--color-primary-500) / <alpha-value>)',
          600: 'rgb(var(--color-primary-600) / <alpha-value>)',
          700: 'rgb(var(--color-primary-700) / <alpha-value>)',
          800: 'rgb(var(--color-primary-900) / <alpha-value>)',
          900: 'rgb(var(--color-primary-950) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Cairo', 'Inter', 'system-ui', 'sans-serif'],
        arabic: ['Cairo', 'sans-serif'],
        english: ['Inter', 'sans-serif'],
      },
      backgroundImage: {
        'yemeni-pattern': "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 20 L10 10 L20 20 L30 10 L40 20 L50 10 L60 20' stroke='%23B0AEFF' stroke-width='2' fill='none' opacity='0.1'/%3E%3C/svg%3E\")",
        'zigzag-gold': "repeating-linear-gradient(45deg, #B0AEFF 0px, #B0AEFF 10px, transparent 10px, transparent 20px)",
        'teal-gradient': 'linear-gradient(135deg, rgb(var(--color-primary-500)) 0%, rgb(var(--color-primary-700)) 100%)',
        'mint-gradient': 'linear-gradient(135deg, rgb(var(--color-mint-500)) 0%, rgb(var(--color-mint-400)) 100%)',
        'gold-gradient': 'linear-gradient(135deg, rgb(var(--color-gold-500)) 0%, rgb(var(--color-gold-200)) 100%)',
        'dark-teal-gradient': 'linear-gradient(135deg, rgb(var(--color-primary-700)) 0%, rgb(var(--color-primary-950)) 100%)',
        // Keep red-gradient for backward compatibility but map to Green
        'red-gradient': 'linear-gradient(135deg, rgb(var(--color-primary-500)) 0%, rgb(var(--color-primary-700)) 100%)',
        'dark-red-gradient': 'linear-gradient(135deg, rgb(var(--color-primary-700)) 0%, rgb(var(--color-primary-950)) 100%)',
      },
      boxShadow: {
        'gold': '0 0 20px rgb(var(--color-gold-500) / 0.3)',
        'gold-lg': '0 0 30px rgb(var(--color-gold-500) / 0.4)',
        'teal': '0 0 20px rgb(var(--color-primary-500) / 0.3)',
        'teal-lg': '0 0 30px rgb(var(--color-primary-500) / 0.4)',
        // Keep red for backward compatibility but map to Green
        'red': '0 0 20px rgb(var(--color-primary-500) / 0.3)',
        'red-lg': '0 0 30px rgb(var(--color-primary-500) / 0.4)',
      },
      animation: {
        'shimmer': 'shimmer 2s linear infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px rgb(var(--color-gold-500) / 0.5)' },
          '100%': { boxShadow: '0 0 20px rgb(var(--color-gold-500) / 0.8)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
