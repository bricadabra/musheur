import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages serves the project at /musheur/, the dev server at the root.
  base: process.env.NODE_ENV === 'production' ? '/musheur/' : '/',
  publicDir: 'public',
  plugins: [tailwindcss()],
  server: { port: 3000, open: true },
});
