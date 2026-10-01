import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    // The webview build writes into dist/webview and runs first; emptying
    // here would delete it.
    emptyOutDir: false,
    target: 'node20',
    ssr: true,
    // Development only. vsce's ignore rules failed to keep the map out of the
    // vsix, so production builds do not emit one.
    sourcemap: mode !== 'production',
    minify: false,
    lib: {
      entry: 'src/extension.ts',
      formats: ['cjs'],
      fileName: () => 'extension.cjs',
    },
    rollupOptions: {
      // Provided by the extension host at runtime, never bundled.
      external: ['vscode'],
      codeSplitting: false,
    },
  },
}));
