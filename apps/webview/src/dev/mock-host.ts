import type {
  ExtensionDetails,
  HostApi,
  HostEvents,
  InstallResult,
  Transport,
} from '@pvmp/contract';
import { serveIpc } from '@pvmp/contract';

import type { Scenario, ScenarioName } from './fixtures.ts';
import { buildScenario, CHANGELOG, fixtureIcon, snapshot } from './fixtures.ts';

/** Test control surface, reachable from Playwright via page.evaluate. */
export interface MockControl {
  scenario: ScenarioName;
  /** Emits a host event. */
  emit: <K extends keyof HostEvents & string>(event: K, ...args: Parameters<HostEvents[K]>) => void;
  /** Calls the webview made, in order. */
  calls: { method: string; args: unknown[] }[];
}

declare global {
  interface Window {
    __pvmpMock?: MockControl;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Installs a fake extension host.
 *
 * It replaces `window.acquireVsCodeApi`, so the app's IPC code runs
 * unchanged: request ids, timeouts, events, and the structured clone of
 * `window.postMessage`. A payload the real bridge cannot carry fails here
 * too (SPEC.md §13.1).
 */
export function installMockHost(scenarioName: ScenarioName = 'default'): MockControl {
  const scenario: Scenario = buildScenario(scenarioName);
  const calls: MockControl['calls'] = [];
  let state: unknown;

  // webview -> host
  let toHost: ((message: unknown) => void) | undefined;
  window.acquireVsCodeApi = () => ({
    postMessage: (message) => toHost?.(message),
    getState: () => state,
    setState: (next) => {
      state = next;
    },
  });

  // host -> webview, over the same window message channel the real bridge reads.
  const hostTransport: Transport = {
    post: (message) => window.postMessage(message, '*'),
    subscribe(handler) {
      toHost = (message) => {
        if (typeof message === 'object' && message !== null && 'method' in message) {
          const request = message as { method: string; args?: unknown[] };
          calls.push({ method: request.method, args: request.args ?? [] });
        }
        handler(message);
      };
      return () => {
        toHost = undefined;
      };
    },
  };

  const findEntry = (extensionId: string) => {
    const entry = scenario.entries.find((e) => e.extensionId === extensionId);
    if (!entry) throw new Error(`No such extension: ${extensionId}`);
    return entry;
  };

  const api: HostApi = {
    listCatalog: () => Promise.resolve(snapshot(scenario)),

    getDetails: (extensionId, version) => {
      const entry = findEntry(extensionId);
      const selected = version ?? entry.latest?.version ?? entry.versions[0]?.version ?? '';
      const details: ExtensionDetails = {
        entry,
        selectedVersion: selected,
        readme: scenario.readme,
        changelog: CHANGELOG,
        links: {
          repository: 'https://github.com/acme/lint',
          homepage: 'https://acme.example/lint',
          bugs: 'https://github.com/acme/lint/issues',
          license: 'MIT',
        },
      };
      return Promise.resolve(details);
    },

    getIcon: (extensionId) =>
      Promise.resolve(scenario.icons ? fixtureIcon(extensionId) : undefined),

    install: async (extensionId, version) => {
      const emit = host.emit.bind(host);
      for (const phase of ['downloading', 'extracting', 'installing'] as const) {
        emit('installProgress', { extensionId, version, phase });
        // One phase after another, like a real install.
        // oxlint-disable-next-line no-await-in-loop
        if (scenario.installDelayMs) await sleep(scenario.installDelayMs);
      }

      if (scenario.installFails) {
        emit('installProgress', { extensionId, version, phase: 'failed' });
        const failure: InstallResult = {
          ok: false,
          reloadRequired: false,
          error: 'Installation failed: the registry returned 500.',
        };
        return failure;
      }

      const entry = findEntry(extensionId);
      entry.installed = { version, external: false };
      entry.status = entry.latest?.version === version ? 'installed' : 'update-available';

      emit('installProgress', { extensionId, version, phase: 'done' });
      emit('catalogChanged');
      return { ok: true, reloadRequired: false };
    },

    uninstall: (extensionId) => {
      const entry = findEntry(extensionId);
      delete entry.installed;
      entry.status = 'available';
      host.emit('catalogChanged');
      return Promise.resolve({ ok: true, reloadRequired: false });
    },

    refresh: () => {
      host.emit('catalogChanged');
      return Promise.resolve();
    },

    signIn: (sourceId) => {
      scenario.errors = scenario.errors.filter((e) => e.sourceId !== sourceId);
      scenario.entries = buildScenario('default').entries;
      host.emit('catalogChanged');
      return Promise.resolve();
    },

    setPreReleaseOptIn: (extensionId, on) => {
      findEntry(extensionId).preReleaseOptIn = on;
      host.emit('catalogChanged');
      return Promise.resolve();
    },

    openExtension: () => Promise.resolve(),
    openLog: () => Promise.resolve(),
    addLocalSource: () => Promise.resolve(),
  };

  const host = serveIpc<HostApi, HostEvents>(api, hostTransport);

  const control: MockControl = {
    scenario: scenarioName,
    emit: (event, ...args) => host.emit(event, ...args),
    calls,
  };
  window.__pvmpMock = control;
  return control;
}
