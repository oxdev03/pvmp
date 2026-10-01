import type { ApiShape, EventMap, RequestMessage, Transport } from './protocol.ts';
import { isRequest } from './protocol.ts';

export interface IpcHost<Events extends EventMap> {
  emit<K extends keyof Events & string>(event: K, ...args: Parameters<Events[K]>): void;
  dispose(): void;
}

export interface IpcHostOptions {
  /** Called for every dispatch failure so the host can log it. */
  onError?: (method: string, error: unknown) => void;
}

/**
 * Serves `impl` over `transport`.
 *
 * `impl` must be a plain object whose own enumerable properties are the API
 * methods. Method names come from the webview, so dispatch looks them up in a
 * map built here, never by indexing `impl`. That keeps `__proto__`,
 * `constructor` and inherited members out of reach.
 */
export function serveIpc<Api extends ApiShape, Events extends EventMap>(
  impl: Api,
  transport: Transport,
  options: IpcHostOptions = {},
): IpcHost<Events> {
  const methods = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  for (const [name, value] of Object.entries(impl)) {
    if (typeof value === 'function') {
      methods.set(name, (value as (...args: unknown[]) => Promise<unknown>).bind(impl));
    }
  }

  let disposed = false;

  async function dispatch(request: RequestMessage): Promise<void> {
    const handler = methods.get(request.method);
    if (!handler) {
      transport.post({
        t: 'res',
        id: request.id,
        ok: false,
        error: { message: `Unknown method '${request.method}'`, name: 'UnknownMethodError' },
      });
      return;
    }

    try {
      const value = await handler(...request.args);
      if (!disposed) transport.post({ t: 'res', id: request.id, ok: true, value });
    } catch (error) {
      options.onError?.(request.method, error);
      if (disposed) return;
      transport.post({
        t: 'res',
        id: request.id,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error ? { name: error.name } : {}),
        },
      });
    }
  }

  const unsubscribe = transport.subscribe((raw) => {
    if (!isRequest(raw)) return;
    void dispatch(raw);
  });

  return {
    emit(event, ...args) {
      if (disposed) return;
      transport.post({ t: 'evt', event, args });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  };
}
