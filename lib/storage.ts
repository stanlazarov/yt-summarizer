// Typed wrappers around chrome.storage. The API key lives only in
// storage.local; never storage.sync, never logged.

import { browser } from 'wxt/browser';
import type { Summary } from './summarize';

export const MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fast, cheap)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (better for hard videos)' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];
export const DEFAULT_MODEL: ModelId = 'claude-haiku-5-5';

export interface Settings {
  apiKey: string;
  model: ModelId;
}

export async function getSettings(): Promise<Settings> {
  const { apiKey, model } = await browser.storage.local.get(['apiKey', 'model']);
  return {
    apiKey: typeof apiKey === 'string' ? apiKey : '',
    model: MODELS.some((m) => m.id === model) ? (model as ModelId) : DEFAULT_MODEL,
  };
}

export async function setSettings(settings: Partial<Settings>): Promise<void> {
  await browser.storage.local.set(settings);
}

/** An error the user can act on. `action: "options"` means show a link to Options. */
export interface UserError {
  message: string;
  action?: 'options' | 'reload';
}

export type SummaryState =
  | { status: 'loading'; updatedAt: number }
  | { status: 'done'; title: string; summary: Summary; updatedAt: number }
  | { status: 'error'; error: UserError; updatedAt: number };

const summaryKey = (videoId: string) => `summary:${videoId}`;

export async function getSummaryState(videoId: string): Promise<SummaryState | undefined> {
  const key = summaryKey(videoId);
  const result = await browser.storage.session.get(key);
  return result[key] as SummaryState | undefined;
}

export async function setSummaryState(videoId: string, state: SummaryState): Promise<void> {
  await browser.storage.session.set({ [summaryKey(videoId)]: state });
}

/** Calls `callback` whenever the summary state for `videoId` changes. Returns an unsubscribe function. */
export function watchSummaryState(
  videoId: string,
  callback: (state: SummaryState | undefined) => void,
): () => void {
  const key = summaryKey(videoId);
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'session' && key in changes) callback(changes[key]!.newValue as SummaryState | undefined);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
