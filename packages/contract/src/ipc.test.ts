import { describe, expect, it, vi } from 'vitest';

import { createIpcClient, IpcDisposedError, IpcTimeoutError } from './client.ts';
import { serveIpc } from './host.ts';
import type { ApiShape, EventMap } from './protocol.ts';
import { createTransportPair } from './testing.ts';

interface TestApi extends ApiShape {
  add(a: number, b: number): Promise<number>;
  boom(): Promise<never>;
  never(): Promise<void>;
}

interface TestEvents extends EventMap {
  ping: (value: string) => void;
}

function setup(overrides: Partial<TestApi> = {}, timeoutMs = 30_000) {
  const impl: TestApi = {
    add: (a, b) => Promise.resolve(a + b),
    boom: () => {
      const error = new Error('kaboom');
      error.name = 'BoomError';
      return Promise.reject(error);
    },
    never: () => new Promise<void>(() => {}),
    ...overrides,
  };
  const { a, b } = createTransportPair();
  const host = serveIpc<TestApi, TestEvents>(impl, a);
  const client = createIpcClient<TestApi, TestEvents>(b, { timeoutMs });
  return { host, client, impl };
}

describe('ipc request/response', () => {
  it('round-trips a call and its arguments', async () => {
    const { client } = setup();
    await expect(client.api.add(2, 3)).resolves.toBe(5);
  });

  it('keeps concurrent requests distinct', async () => {
    const { client } = setup();
    const results = await Promise.all([
      client.api.add(1, 1),
      client.api.add(2, 2),
      client.api.add(3, 3),
    ]);
    expect(results).toEqual([2, 4, 6]);
  });

  it('propagates the error message and name', async () => {
    const { client } = setup();
    await expect(client.api.boom()).rejects.toThrow('kaboom');
    await expect(client.api.boom()).rejects.toMatchObject({ name: 'BoomError' });
  });

  it('rejects an unknown method rather than hanging', async () => {
    const { client } = setup();
    const call = (client.api as unknown as Record<string, () => Promise<unknown>>)['nope'];
    await expect(call!()).rejects.toThrow(/Unknown method 'nope'/);
  });

  it('reports host dispatch failures through onError', async () => {
    const onError = vi.fn<(method: string, error: unknown) => void>();
    const { a, b } = createTransportPair();
    serveIpc<TestApi, TestEvents>(
      {
        add: () => Promise.reject(new Error('x')),
        boom: () => Promise.reject(new Error('x')),
        never: () => Promise.resolve(),
      },
      a,
      { onError },
    );
    const client = createIpcClient<TestApi, TestEvents>(b);
    await expect(client.api.add(1, 2)).rejects.toThrow('x');
    expect(onError).toHaveBeenCalledWith('add', expect.any(Error));
  });
});

describe('ipc method resolution is not a property lookup', () => {
  // Method names come from the webview. Only the impl's own functions may be
  // callable, or a webview could reach Object.prototype.
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'rejects %s',
    async (name) => {
      const { client } = setup();
      const call = (client.api as unknown as Record<string, () => Promise<unknown>>)[name];
      await expect(call!()).rejects.toThrow(/Unknown method/);
    },
  );
});

describe('ipc timeouts', () => {
  it('rejects a pending request after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const { client } = setup({}, 1000);
      const pending = client.api.never();
      // oxlint-disable-next-line vitest/valid-expect -- awaited below, after the timers advance
      const assertion = expect(pending).rejects.toBeInstanceOf(IpcTimeoutError);
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reject a request that answered in time', async () => {
    vi.useFakeTimers();
    try {
      const { client } = setup({}, 1000);
      const result = client.api.add(1, 2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe(3);
      await vi.advanceTimersByTimeAsync(5000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ipc events', () => {
  it('delivers to every listener and honours unsubscribe', async () => {
    const { host, client } = setup();
    const first = vi.fn<(value: string) => void>();
    const second = vi.fn<(value: string) => void>();
    const off = client.on('ping', first);
    client.on('ping', second);

    host.emit('ping', 'one');
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith('one'));
    expect(second).toHaveBeenCalledWith('one');

    off();
    host.emit('ping', 'two');
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith('two'));
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('tolerates a listener unsubscribing during dispatch', async () => {
    const { host, client } = setup();
    const calls: string[] = [];
    const off = client.on('ping', () => {
      calls.push('a');
      off();
    });
    client.on('ping', () => calls.push('b'));

    host.emit('ping', 'x');
    await vi.waitFor(() => expect(calls).toEqual(['a', 'b']));
  });
});

describe('ipc disposal', () => {
  it('rejects in-flight and subsequent requests', async () => {
    const { client } = setup();
    const inFlight = client.api.never();
    client.dispose();
    await expect(inFlight).rejects.toBeInstanceOf(IpcDisposedError);
    await expect(client.api.add(1, 1)).rejects.toBeInstanceOf(IpcDisposedError);
  });
});
