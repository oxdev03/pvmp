/** Wire format for the webview <-> extension host bridge. */

export interface RequestMessage {
  t: 'req';
  id: number;
  method: string;
  args: unknown[];
}

export interface ResponseOk {
  t: 'res';
  id: number;
  ok: true;
  value: unknown;
}

export interface ResponseErr {
  t: 'res';
  id: number;
  ok: false;
  error: { message: string; name?: string };
}

export type ResponseMessage = ResponseOk | ResponseErr;

export interface EventMessage {
  t: 'evt';
  event: string;
  args: unknown[];
}

/** host -> webview */
export type HostMessage = ResponseMessage | EventMessage;
/** webview -> host */
export type ClientMessage = RequestMessage;

/**
 * `never[]` rather than `unknown[]` so concrete interfaces with specific
 * parameter types stay assignable to these constraints under strict variance.
 */
export type ApiShape = Record<string, (...args: never[]) => Promise<unknown>>;
export type EventMap = Record<string, (...args: never[]) => void>;

/**
 * The only thing either side needs from its environment. The webview supplies
 * one backed by `acquireVsCodeApi()`, the host one backed by `Webview`, and
 * tests one backed by a direct function call.
 */
export interface Transport {
  post(message: unknown): void;
  subscribe(handler: (message: unknown) => void): () => void;
}

export function isRequest(m: unknown): m is RequestMessage {
  return typeof m === 'object' && m !== null && (m as RequestMessage).t === 'req';
}

export function isResponse(m: unknown): m is ResponseMessage {
  return typeof m === 'object' && m !== null && (m as ResponseMessage).t === 'res';
}

export function isEvent(m: unknown): m is EventMessage {
  return typeof m === 'object' && m !== null && (m as EventMessage).t === 'evt';
}
