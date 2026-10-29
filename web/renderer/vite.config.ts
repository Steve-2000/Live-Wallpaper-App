import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The bundle is served to WebView2 from a virtual host mapped to the local
// renderer folder (https://renderer.dreamcanvas.local/), so all URLs stay relative.
// Two pages share one build: index.html (wallpaper runtime) and editor.html (scene editor).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    // The on-disk transform cache keeps stale import.meta.glob results, so newly added presets
    // would be invisible to the registry tests until the cache was deleted by hand.
    experimental: { fsModuleCache: false },
  },
});
