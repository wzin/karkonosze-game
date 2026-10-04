import { defineConfig } from 'vite';

export default defineConfig({
  // relative URLs everywhere, so the build runs from any sub-path
  base: './',
  build: {
    target: 'es2022',
    // public/assets/ holds generated gfx and audio; keep Vite's bundles out of that folder
    assetsDir: 'app',
  },
});
