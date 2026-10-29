// Typed message contracts between popup, options, background, and content
// script. Add a type here before sending any new message.

import { browser } from 'wxt/browser';
import type { Segment } from './transcript';
import type { ModelId, UserError } from './storage';

export interface Transcript {
  videoId: string;
  title: string;
  durationSec: number;
  segments: Segment[];
}

/** Message name → request payload and response type. */
export interface MessageMap {
  /** popup → background: start a summary unless one exists (or `force`). */
  getSummary: { req: { videoId: string; tabId: number; force?: boolean }; res: void };
  /** options → background: check that an API key works. */
  testKey: { req: { apiKey: string; model: ModelId }; res: void };
  /** background → content script: fetch the transcript for a video. */
  getTranscript: { req: { videoId: string }; res: Transcript };
  /** popup → content script: seek the page's video. */
  seek: { req: { seconds: number }; res: void };
}

export type MessageType = keyof MessageMap;
export type Message = { [K in MessageType]: { type: K } & MessageMap[K]['req'] }[MessageType];
export type MessageOf<K extends MessageType> = Extract<Message, { type: K }>;

/**
 * Errors don't survive chrome messaging, so every response is wrapped. A
 * failure carries a UserError that can be shown as-is.
 */
export type Response<T> = { ok: true; data: T } | { ok: false; error: UserError };

/** Thrown by send helpers when the receiver reports a failure. */
export class MessageError extends Error {
  constructor(readonly userError: UserError) {
    super(userError.message);
  }
}

export async function sendToBackground<K extends MessageType>(
  msg: MessageOf<K>,
): Promise<MessageMap[K]['res']> {
  return unwrap(await browser.runtime.sendMessage(msg));
}

export async function sendToTab<K extends MessageType>(
  tabId: number,
  msg: MessageOf<K>,
): Promise<MessageMap[K]['res']> {
  let response: unknown;
  try {
    response = await browser.tabs.sendMessage(tabId, msg);
  } catch {
    // No content script in the tab, usually because the tab was open before
    // the extension was installed or reloaded.
    throw new MessageError({ message: 'Reload the YouTube tab and try again.', action: 'reload' });
  }
  return unwrap(response);
}

function unwrap<T>(response: unknown): T {
  const r = response as Response<T> | undefined;
  if (!r) throw new MessageError({ message: 'Something went wrong, try again.' });
  if (!r.ok) throw new MessageError(r.error);
  return r.data;
}

type Handlers = { [K in MessageType]?: (msg: MessageOf<K>) => Promise<MessageMap[K]['res']> };

/**
 * Registers handlers for the given message types. A handler that throws a
 * MessageError sends its UserError back; anything else becomes a generic error.
 */
export function onMessages(handlers: Handlers): void {
  browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    const type = (msg as { type?: unknown } | null)?.type;
    const handler = typeof type === 'string' ? (handlers as Record<string, ((m: unknown) => Promise<unknown>) | undefined>)[type] : undefined;
    if (!handler) return false;
    handler(msg).then(
      (data) => sendResponse({ ok: true, data } satisfies Response<unknown>),
      (err: unknown) => sendResponse({ ok: false, error: toUserError(err) } satisfies Response<unknown>),
    );
    return true; // keep the channel open for the async response
  });
}

export function toUserError(err: unknown): UserError {
  if (err instanceof MessageError) return err.userError;
  console.error(err);
  return { message: 'Something went wrong, try again.' };
}
