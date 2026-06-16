// Tailwind CSS v4 plugs into Next.js through PostCSS — no tailwind.config.js
// needed. The design tokens live in app/globals.css under the @theme block.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
