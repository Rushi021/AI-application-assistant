/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        wf: {
          bg: "#0f0f0f",
          surface: "#1a1a1a",
          surfaceHover: "#222222",
          border: "#2a2a2a",
          borderBright: "#3a3a3a",
          text: "#f0f0f0",
          muted: "#888888",
          dim: "#555555",
          panel: "#141414",
          tagGreen: "#0f2a1a",
          tagRed: "#2a1a1a",
          warn: "#f87171",
        },
        primary: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea580c",
          700: "#c2410c",
          800: "#9a3412",
          900: "#7c2d12",
          950: "#431407",
        },
      },
    },
  },
  plugins: [],
};
