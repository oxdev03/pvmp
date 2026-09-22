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
 * `acquireVsCodeApi` throws on a second call, so this must run once per
 * document; the provider's client singleton guarantees that.
 *
 * The Playwright harness replaces `window.acquireVsCodeApi` rather than this
 * function, so tests drive the exact same code path, structured clone
 * included (SPEC.md §13.1).
 */
export function createVsCodeTransport(): Transport {
  const acquire = globalThis.window?.acquireVsCodeApi;
  if (!acquire) {
    throw new Error('acquireVsCodeApi is unavailable: not running inside a VS Code webview');
  }
  const api = acquire();
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
