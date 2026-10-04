import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // public/assets/ holds generated gfx and audio; keep Vite's bundles out of that folder
    assetsDir: 'app',
  },
});
