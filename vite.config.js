import { defineConfig } from 'vite';
import { glob } from 'glob';

export default defineConfig({
  // Tell Vite the source code is in 'src'
  root: 'src',
  base: '/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    minify: 'terser',
    rollupOptions: {
      // FIX: Use a simple string pattern with forward slashes.
      // This works on Windows, Mac, and Linux.
      input: glob.sync('src/**/*.html'),
    },
  },
  publicDir: false
});