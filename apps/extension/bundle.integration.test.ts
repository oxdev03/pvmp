import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Loads the packaged bundle with a stub `vscode` module.
 *
 * Stands in for extension-host tests (SPEC.md §13). It misses VS Code API
 * misuse, but catches the bundling mistakes that otherwise show up only after
 * someone installs the vsix: CJS/ESM interop failures, a missing external,
 * top-level code that throws, or a manifest command nobody registers.
 */
const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, 'dist', 'extension.cjs');

interface Recorded {
  commands: string[];
  viewProviders: string[];
  outputChannels: string[];
  intervals: number;
}

class Disposable {
  constructor(private readonly callOnDispose?: () => void) {}
  dispose(): void {
    this.callOnDispose?.();
  }
}

const uri = (path: string) => ({
  path,
  fsPath: path,
  scheme: 'file',
  toString: () => `file://${path}`,
  with: () => uri(path),
});

const noopEvent = () => new Disposable();

function createVscodeStub(recorded: Recorded) {
  return {
    version: '1.98.0',
    Disposable,
    Uri: {
      file: uri,
      parse: uri,
      joinPath: (base: { path: string }, ...parts: string[]) =>
        uri([base.path, ...parts].join('/')),
    },
    RelativePattern: class {
      constructor(
        readonly base: unknown,
        readonly pattern: string,
      ) {}
    },
    ViewColumn: { Active: -1, One: 1 },
    ProgressLocation: { Notification: 15 },
    ConfigurationTarget: { Global: 1 },
    FileType: { File: 1, Directory: 2 },
    EventEmitter: class {
      event = noopEvent;
      fire(): void {}
      dispose(): void {}
    },
    window: {
      createOutputChannel: (name: string) => {
        recorded.outputChannels.push(name);
        return {
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          show: () => {},
          dispose: () => {},
        };
      },
      registerWebviewViewProvider: (id: string) => {
        recorded.viewProviders.push(id);
        return new Disposable();
      },
      createWebviewPanel: () => ({
        webview: { onDidReceiveMessage: noopEvent, postMessage: () => Promise.resolve(true) },
        onDidDispose: noopEvent,
        reveal: () => {},
        dispose: () => {},
      }),
      showInformationMessage: () => Promise.resolve(undefined),
      showErrorMessage: () => Promise.resolve(undefined),
      showQuickPick: () => Promise.resolve(undefined),
      showInputBox: () => Promise.resolve(undefined),
      showOpenDialog: () => Promise.resolve(undefined),
      withProgress: (_options: unknown, task: () => unknown) => Promise.resolve(task()),
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({
        get: (_key: string, fallback?: unknown) => fallback,
        update: () => Promise.resolve(),
      }),
      onDidChangeConfiguration: noopEvent,
      createFileSystemWatcher: () => ({
        onDidCreate: noopEvent,
        onDidChange: noopEvent,
        onDidDelete: noopEvent,
        dispose: () => {},
      }),
      fs: {
        readFile: () => Promise.reject(new Error('ENOENT')),
        writeFile: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        readDirectory: () => Promise.resolve([]),
        createDirectory: () => Promise.resolve(),
        stat: () => Promise.reject(new Error('ENOENT')),
      },
    },
    extensions: {
      all: [],
      getExtension: () => undefined,
      onDidChange: noopEvent,
    },
    commands: {
      registerCommand: (id: string) => {
        recorded.commands.push(id);
        return new Disposable();
      },
      executeCommand: () => Promise.resolve(undefined),
    },
  };
}

interface ExtensionModule {
  activate: (context: unknown) => void;
  deactivate: () => void;
  COMMANDS: Record<string, string>;
}

describe('packaged bundle', () => {
  let loaded: ExtensionModule;
  const recorded: Recorded = {
    commands: [],
    viewProviders: [],
    outputChannels: [],
    intervals: 0,
  };

  beforeAll(() => {
    if (!existsSync(BUNDLE)) {
      throw new Error(`${BUNDLE} is missing. Run \`pnpm build\` first.`);
    }

    const require = createRequire(import.meta.url);
    const Module = require('node:module') as {
      _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const original = Module._load;
    const stub = createVscodeStub(recorded);

    Module._load = (request, parent, isMain) =>
      request === 'vscode' ? stub : original(request, parent, isMain);

    try {
      loaded = require(BUNDLE) as ExtensionModule;
    } finally {
      Module._load = original;
    }
  });

  it('loads without throwing and exports the activation contract', () => {
    expect(typeof loaded.activate).toBe('function');
    expect(typeof loaded.deactivate).toBe('function');
  });

  it('does not bundle the vscode module', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(BUNDLE, 'utf8');
    expect(source).toContain('require("vscode")');
  });

  it('activates and registers every command the manifest declares', async () => {
    vi.useFakeTimers();
    try {
      loaded.activate({
        subscriptions: [],
        globalStorageUri: { path: '/tmp/pvmp', fsPath: '/tmp/pvmp', scheme: 'file' },
        extensionUri: { path: '/ext', fsPath: '/ext', scheme: 'file' },
        globalState: { get: (_k: string, d: unknown) => d, update: () => Promise.resolve() },
        secrets: {
          get: () => Promise.resolve(undefined),
          store: () => Promise.resolve(),
          delete: () => Promise.resolve(),
        },
      });
    } finally {
      vi.useRealTimers();
    }

    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(join(here, 'package.json'), 'utf8')) as {
      contributes: { commands: { command: string }[] };
    };
    const declared = manifest.contributes.commands.map((c) => c.command).toSorted();

    expect(recorded.commands.toSorted()).toEqual(declared);
    expect(recorded.viewProviders).toEqual(['pvmp.marketplace']);
    expect(recorded.outputChannels).toEqual(['Private Marketplace']);
  });

  it('deactivates cleanly', () => {
    expect(() => loaded.deactivate()).not.toThrow();
  });
});
