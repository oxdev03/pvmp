import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    // The webview build writes into dist/webview and runs first; emptying
    // here would delete it.
    emptyOutDir: false,
    target: 'node20',
    ssr: true,
    // Only for `pnpm watch` (--mode development). vsce's ignore rules do not
    // reliably exclude a re-included path, so the map simply is not produced
    // for a packaged build rather than being filtered out afterwards.
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
