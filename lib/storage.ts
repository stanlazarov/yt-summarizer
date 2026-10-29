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

/** Popup size presets. Chrome caps extension popups at 800×600. */
export const POPUP_SIZES = [
  { id: 'small', label: 'Small', width: 360, height: 480 },
  { id: 'medium', label: 'Medium', width: 440, height: 580 },
  { id: 'large', label: 'Large', width: 600, height: 600 },
  { id: 'wide', label: 'Wide', width: 780, height: 600 },
] as const;

export type PopupSize = (typeof POPUP_SIZES)[number];
export type PopupSizeId = PopupSize['id'];

export async function getPopupSize(): Promise<PopupSize> {
  const { popupSize } = await browser.storage.local.get('popupSize');
  return POPUP_SIZES.find((s) => s.id === popupSize) ?? POPUP_SIZES[1];
}

export async function setPopupSize(id: PopupSizeId): Promise<void> {
  await browser.storage.local.set({ popupSize: id });
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
