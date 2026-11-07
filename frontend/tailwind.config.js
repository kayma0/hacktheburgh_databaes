/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { brand: { 50: "#fdf2f4", 100: "#fbe4e8", 500: "#b4234a", 600: "#9a1c3e", 700: "#7d1733" } } } },
  plugins: [],
};
