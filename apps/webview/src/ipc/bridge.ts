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

/**
 * The production transport.
 *
 * `acquireVsCodeApi` throws on a second call. The provider's client
 * singleton calls this once per document.
 *
 * The Playwright harness fakes `window.acquireVsCodeApi`, so tests run this
 * code too (SPEC.md §13.1).
 */
export function createVsCodeTransport(): Transport {
  const acquire = globalThis.window?.acquireVsCodeApi;
  if (!acquire) {
    throw new Error('acquireVsCodeApi is unavailable: not running inside a VS Code webview');
  }
  const api = acquire();
  return {
    // The VS Code API's postMessage, which has no target origin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    post: (message) => api.postMessage(message),
    subscribe(handler) {
      const listener = (event: MessageEvent<unknown>) => handler(event.data);
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}
