import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Emitted straight into the extension's bundle output so vsce packages it.
    outDir: '../extension/dist/webview',
    emptyOutDir: true,
    target: 'es2022',
    // One stylesheet for both views: the host writes a single <link> whose
    // href it can build by name, with no manifest lookup.
    cssCodeSplit: false,
    // Predictable filenames: the host builds webview URIs by name, and a
    // content hash would mean reading the manifest just to render a panel.
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
