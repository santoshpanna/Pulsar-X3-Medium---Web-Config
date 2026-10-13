import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the built site works from any sub-path (GitHub Pages etc.)
  base: './',
  build: { target: 'es2022' },
});
