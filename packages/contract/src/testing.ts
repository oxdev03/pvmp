import type { Transport } from './protocol.ts';

/**
 * A pair of transports wired to each other, delivering asynchronously so tests
 * exercise the same ordering the real `postMessage` bridge has, and through
 * JSON, as VS Code serializes webview messages.
 */
export function createTransportPair(): { a: Transport; b: Transport } {
  const handlers: { a: Set<(m: unknown) => void>; b: Set<(m: unknown) => void> } = {
    a: new Set(),
    b: new Set(),
  };

  const make = (self: 'a' | 'b', peer: 'a' | 'b'): Transport => ({
    post(message) {
      const delivered: unknown = JSON.parse(JSON.stringify(message));
      queueMicrotask(() => {
        for (const handler of Array.from(handlers[peer])) handler(delivered);
      });
    },
    subscribe(handler) {
      handlers[self].add(handler);
      return () => handlers[self].delete(handler);
    },
  });

  return { a: make('a', 'b'), b: make('b', 'a') };
}
