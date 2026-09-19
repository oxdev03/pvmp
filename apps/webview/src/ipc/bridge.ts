import type { Transport } from '@pvmp/contract';

export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

let cached: VsCodeApi | undefined;

/**
 * `acquireVsCodeApi` throws if called more than once per webview, and React
 * strict mode mounts twice in development, so it is memoized here.
 */
export function getVsCodeApi(): VsCodeApi {
  if (cached) return cached;
  const acquire = globalThis.window?.acquireVsCodeApi;
  if (!acquire) {
    throw new Error('acquireVsCodeApi is unavailable: not running inside a VS Code webview');
  }
  cached = acquire();
  return cached;
}

/**
 * The production transport.
 *
 * The Playwright harness replaces `window.acquireVsCodeApi` rather than this
 * function, so tests drive the exact same code path, structured clone
 * included (SPEC.md §13.1).
 */
export function createVsCodeTransport(): Transport {
  const api = getVsCodeApi();
  return {
    // Not window.postMessage: the VS Code webview API takes a single argument
    // and has no targetOrigin parameter.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    post: (message) => api.postMessage(message),
    subscribe(handler) {
      const listener = (event: MessageEvent<unknown>) => handler(event.data);
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}
