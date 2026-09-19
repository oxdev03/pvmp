/**
 * A minimal incremental tar reader.
 *
 * nanotar parses a complete buffer, which is the right tool once the whole
 * tarball is in hand. This exists for the other case: pulling one small entry
 * out of the front of a stream and aborting the download before the multi-MB
 * `extension.vsix` arrives (SPEC.md §6.3).
 */

import { Gunzip } from 'fflate';

const BLOCK = 512;
const NAME = [0, 100] as const;
const SIZE = [124, 136] as const;
const TYPE = 156;
const PREFIX = [345, 500] as const;

const decoder = new TextDecoder();

function cstr(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end)).trim();
}

/** Tar stores sizes as NUL- or space-terminated octal. */
function octal(bytes: Uint8Array): number {
  const text = cstr(bytes);
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Strips npm's `package/` wrapper and lowercases, so lookups are stable. */
export function normalizeEntryName(name: string): string {
  return name
    .replace(/^\.?\/*/, '')
    .replace(/^package\//, '')
    .toLowerCase();
}

export interface TarScanResult {
  entries: Map<string, Uint8Array>;
  /** True once every wanted entry has been seen, or the archive ended. */
  done: boolean;
}

export class TarScanner {
  // ponytail: chunks are concatenated on each push, which is O(n^2) in the
  // number of chunks. Fine because this path aborts after a few hundred KB;
  // the whole-tarball path uses readTarball instead. Switch to a chunk list
  // with a windowed reader if this ever runs to completion on large inputs.
  #buffer = new Uint8Array(0);
  #entryName: string | undefined;
  #entrySize = 0;
  #entryIsFile = false;
  #finished = false;
  readonly #wanted: ReadonlySet<string>;
  readonly #entries = new Map<string, Uint8Array>();

  constructor(wanted: Iterable<string>) {
    this.#wanted = new Set([...wanted].map((n) => n.toLowerCase()));
  }

  get entries(): Map<string, Uint8Array> {
    return this.#entries;
  }

  /** True when every wanted entry has been found, or the archive ended. */
  get done(): boolean {
    return this.#finished || this.#entries.size === this.#wanted.size;
  }

  push(chunk: Uint8Array): void {
    if (this.#finished) return;
    const next = new Uint8Array(this.#buffer.length + chunk.length);
    next.set(this.#buffer);
    next.set(chunk, this.#buffer.length);
    this.#buffer = next;
    this.#drain();
  }

  #drain(): void {
    for (;;) {
      if (this.#entryName === undefined) {
        if (this.#buffer.length < BLOCK) return;
        const header = this.#buffer.subarray(0, BLOCK);

        // Two consecutive zero blocks end the archive; one is enough to stop.
        if (header.every((byte) => byte === 0)) {
          this.#finished = true;
          return;
        }

        const name = cstr(header.subarray(...NAME));
        const prefix = cstr(header.subarray(...PREFIX));
        const type = String.fromCharCode(header[TYPE] ?? 0);

        this.#entryName = normalizeEntryName(prefix ? `${prefix}/${name}` : name);
        this.#entrySize = octal(header.subarray(...SIZE));
        // '0' and NUL both mean a regular file; anything else we skip over.
        this.#entryIsFile = type === '0' || type === '\0';
        this.#buffer = this.#buffer.subarray(BLOCK);
      }

      const padded = Math.ceil(this.#entrySize / BLOCK) * BLOCK;
      if (this.#buffer.length < padded) return;

      if (this.#entryIsFile && this.#wanted.has(this.#entryName)) {
        this.#entries.set(this.#entryName, this.#buffer.slice(0, this.#entrySize));
      }

      this.#buffer = this.#buffer.subarray(padded);
      this.#entryName = undefined;

      if (this.done) return;
    }
  }
}

/**
 * Reads `wanted` entries from a gzipped tar stream, stopping as soon as it has
 * them all.
 *
 * Deliberately not `pipeThrough(new DecompressionStream('gzip'))`: that starts
 * an independent pipe loop which reads far ahead of what the consumer pulls,
 * so the whole tarball transfers even when the caller stops after a few KB.
 * fflate's push-based Gunzip inflates exactly the chunks we hand it, which is
 * what makes the early abort real.
 *
 * The caller's AbortController should be wired to the underlying fetch so that
 * stopping early actually cancels the transfer.
 */
export async function readTarGzipStream(
  stream: ReadableStream<Uint8Array>,
  wanted: Iterable<string>,
  onComplete?: () => void,
): Promise<Map<string, Uint8Array>> {
  const scanner = new TarScanner(wanted);
  const inflate = new Gunzip();
  inflate.ondata = (chunk) => scanner.push(chunk);

  const reader = stream.getReader();
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- reading a stream is sequential by definition
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) inflate.push(value);
      if (scanner.done) {
        onComplete?.();
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return scanner.entries;
}
