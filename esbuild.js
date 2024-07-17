/* eslint-disable */
const { build } = require('esbuild');
const fs = require('fs');

if (!fs.existsSync('./out')) fs.mkdirSync('./out');
fs.copyFileSync('./node_modules/github-markdown-css/github-markdown.css', './out/github-markdown.css');

//@ts-check
/** @typedef {import('esbuild').BuildOptions} BuildOptions **/

/** @type BuildOptions */
const baseConfig = {
  bundle: true,
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production',
};

/** @type BuildOptions */
const productionConfig = {
  bundle: true,
  minify: true,
  sourcemap: false,
};

// Config for extension source code (to be run in a Node-based context)
/** @type BuildOptions */
const extensionConfig = {
  ...baseConfig,
  platform: 'node',
  mainFields: ['module', 'main'],
  format: 'cjs',
  entryPoints: ['./src/extension.ts'],
  outfile: './out/extension.js',
  external: ['vscode'],
};

// Config for webview source code (to be run in a web-based context)
/** @type BuildOptions */
const webviewConfig = {
  ...baseConfig,
  target: 'es2020',
  format: 'esm',
  entryPoints: ['./media/js/webview.js'],
  outfile: './out/webview.js',
};

// This watch config adheres to the conventions of the esbuild-problem-matchers
// extension (https://github.com/connor4312/esbuild-problem-matchers#esbuild-via-js)
/** @type BuildOptions */
const watchConfig = {
  watch: {
    onRebuild(error) {
      console.log('[watch] build started');
      if (error) {
        error.errors.forEach((error) =>
          console.error(
            `> ${error.location.file}:${error.location.line}:${error.location.column}: error: ${error.text}`
          )
        );
      } else {
        console.log('[watch] build finished');
      }
    },
  },
};

// Build script
(async () => {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--watch')) {
      // Build and watch extension and webview code
      console.log('[watch] build started');
      await build({
        ...extensionConfig,
        ...watchConfig,
      });
      await build({
        ...webviewConfig,
        ...watchConfig,
      });
      console.log('[watch] build finished');
    } else if (args.includes('--production')) {
      // Build extension and webview code
      await build({ ...extensionConfig, ...productionConfig });
      await build({ ...webviewConfig, ...productionConfig });
      console.log('build complete');
    } else {
      await build(extensionConfig);
      await build(webviewConfig);
      console.log('build complete');
    }
  } catch (err) {
    process.stderr.write(err.stderr);
    process.exit(1);
  }
})();
