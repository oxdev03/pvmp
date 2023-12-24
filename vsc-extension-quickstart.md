# VS Code Extension Quick Start

This is a quick start guide for the **Private Marketplace** Visual Studio Code extension.

## Project Structure

- `src/`: Main extension code.
  - `constants.ts`: Contains constant values used across the extension.
  - `extension.ts`: Main entry point for the extension.
  - `models/`: Model definitions are stored here.
  - `test/`: Test files for the extension.
  - `utils.ts`: Utility functions.
  - `views/`: Code related to views.
- `.vscode/`: VS Code specific settings and configurations.
- `esbuild.js`: Build script for the project.
- `tsconfig.json`: TypeScript configuration file.
- `package.json`: Defines project dependencies and scripts.

## Get up and running straight away

- Press `F5` to open a new window with your extension loaded.
- Run your command from the command palette by pressing (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac) and typing `Hello World`.
- Set breakpoints in your code inside `src/extension.ts` to debug your extension.
- Find output from your extension in the debug console.

## Make changes

- You can relaunch the extension from the debug toolbar after changing code in `src/extension.ts`.
- You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load your changes.

## Explore the API

- You can open the full set of our API when you open the file `node_modules/@types/vscode/index.d.ts`.

## Go further

- [Follow UX guidelines](https://code.visualstudio.com/api/ux-guidelines/overview) to create extensions that seamlessly integrate with VS Code's native interface and patterns.
- Reduce the extension size and improve the startup time by [bundling your extension](https://code.visualstudio.com/api/working-with-extensions/bundling-extension).
- [Publish your extension](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) on the VS Code extension marketplace.
- Automate builds by setting up [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration).
