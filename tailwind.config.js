/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: "jit",
  content: [
    "./sidepanel.tsx",
    "./background.ts",
    "./contents/**/*.{ts,tsx}",
    "./tabs/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f8f8f7",
          100: "#efeeec",
          200: "#dcdad6",
          300: "#bdb9b1",
          400: "#9b958a",
          500: "#7c7568",
          600: "#5e5849",
          700: "#46412f",
          800: "#2e2a1d",
          900: "#1a180f"
        }
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif"
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace"
        ]
      }
    }
  },
  plugins: []
};
