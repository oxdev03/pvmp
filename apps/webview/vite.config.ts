import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Into the extension's dist, so vsce packages it.
    outDir: '../extension/dist/webview',
    emptyOutDir: true,
    target: 'es2022',
    // One stylesheet for both views, at a name the host can hard-code.
    cssCodeSplit: false,
    // No content hashes: the host builds asset URIs by name.
    rollupOptions: {
      input: {
        sidebar: 'src/entry-sidebar.tsx',
        details: 'src/entry-details.tsx',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: 'style[extname]',
      },
    },
  },
  server: { port: 5183 },
});
