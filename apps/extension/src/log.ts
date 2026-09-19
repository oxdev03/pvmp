import type { Logger } from '@pvmp/core';
import type * as vscode from 'vscode';

/**
 * A LogOutputChannel gives level filtering and timestamps for free, and the
 * user can raise the level from the Output panel without a reload — which is
 * how support conversations about proxies and TLS actually get resolved
 * (SPEC.md §7.4).
 */
export function createLogger(channel: vscode.LogOutputChannel): Logger {
  return {
    trace: (message, ...args) => channel.trace(message, ...args),
    debug: (message, ...args) => channel.debug(message, ...args),
    info: (message, ...args) => channel.info(message, ...args),
    warn: (message, ...args) => channel.warn(message, ...args),
    error: (message, ...args) => channel.error(message as string | Error, ...args),
  };
}
