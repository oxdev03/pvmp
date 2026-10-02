import type { ApiShape, EventMap, HostMessage, Transport } from './protocol.ts';
import { isEvent, isResponse } from './protocol.ts';

export interface IpcClient<Api extends ApiShape, Events extends EventMap> {
  /** Typed proxy: every call becomes a request and resolves with the reply. */
  readonly api: Api;
  on<K extends keyof Events & string>(event: K, listener: Events[K]): () => void;
  dispose(): void;
}

export interface IpcClientOptions {
  /** Rejects a pending request after this long. Default 30s. */
  timeoutMs?: number;
}

export class IpcTimeoutError extends Error {
  override readonly name = 'IpcTimeoutError';
  constructor(method: string, timeoutMs: number) {
    super(`IPC request '${method}' timed out after ${timeoutMs}ms`);
  }
}

export class IpcDisposedError extends Error {
  override readonly name = 'IpcDisposedError';
  constructor() {
    super('IPC client was disposed before the request completed');
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createIpcClient<Api extends ApiShape, Events extends EventMap>(
  transport: Transport,
  options: IpcClientOptions = {},
): IpcClient<Api, Events> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pending = new Map<number, Pending>();
  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  let nextId = 1;
  let disposed = false;

  const unsubscribe = transport.subscribe((raw) => {
    const message = raw as HostMessage;

    if (isResponse(message)) {
      const entry = pending.get(message.id);
      if (!entry) return; // already timed out, or a stale reply after dispose
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) {
        entry.resolve(message.value);
      } else {
        const error = new Error(message.error.message);
        if (message.error.name) error.name = message.error.name;
        entry.reject(error);
      }
      return;
    }

    if (isEvent(message)) {
      const set = listeners.get(message.event);
      if (!set) return;
      // Snapshot: a listener may unsubscribe itself while we iterate.
      for (const listener of Array.from(set)) {
        (listener as (...args: unknown[]) => void)(...message.args);
      }
    }
  });

  function call(method: string, args: unknown[]): Promise<unknown> {
    if (disposed) return Promise.reject(new IpcDisposedError());
    // VS Code JSON-serializes webview messages, which turns an undefined
    // argument into null. Trimming trailing ones keeps an omitted optional
    // parameter undefined on the host.
    while (args.length > 0 && args.at(-1) === undefined) args.pop();
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new IpcTimeoutError(method, timeoutMs));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      transport.post({ t: 'req', id, method, args });
    });
  }

  const methodCache = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  const api = new Proxy(Object.create(null) as Api, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      let fn = methodCache.get(property);
      if (!fn) {
        fn = (...args: unknown[]) => call(property, args);
        methodCache.set(property, fn);
      }
      return fn;
    },
  });

  return {
    api,
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(event);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new IpcDisposedError());
      }
      pending.clear();
      listeners.clear();
    },
  };
}
