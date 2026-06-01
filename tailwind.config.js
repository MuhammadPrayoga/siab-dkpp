/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./index.html",
    "./renderer.js",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        dkpp: {
          navy: '#000066',
          gold: '#FFD700',
        }
      }
    },
  },
  plugins: [],
};
