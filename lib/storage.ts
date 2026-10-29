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

/** `auto` writes in the transcript's language; anything else is an English language name sent to the prompt. */
export const LANGUAGES = [
  { id: 'auto', label: 'Same as the video' },
  ...[
    'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Polish', 'Ukrainian', 'Russian',
    'Bulgarian', 'Turkish', 'Arabic', 'Hindi', 'Indonesian', 'Vietnamese', 'Japanese', 'Korean', 'Chinese (Simplified)',
    'Chinese (Traditional)',
  ].map((name) => ({ id: name, label: name })),
] as const;

export const LENGTHS = [
  { id: 'brief', label: 'Brief' },
  { id: 'standard', label: 'Standard' },
  { id: 'detailed', label: 'Detailed' },
] as const;

export const STYLES = [
  { id: 'notes', label: 'Notes' },
  { id: 'bullets', label: 'Bullets' },
  { id: 'eli5', label: 'ELI5 (explain simply)' },
] as const;

export type SummaryLength = (typeof LENGTHS)[number]['id'];
export type SummaryStyle = (typeof STYLES)[number]['id'];

/** Everything that changes the summary's content. A cached summary made with different prefs is stale. */
export interface SummaryPrefs {
  language: string;
  length: SummaryLength;
  style: SummaryStyle;
}

export const DEFAULT_PREFS: SummaryPrefs = { language: 'auto', length: 'standard', style: 'notes' };

export interface Settings extends SummaryPrefs {
  apiKey: string;
  model: ModelId;
}

const pick = <T extends string>(options: readonly { id: T }[], value: unknown, fallback: T): T =>
  options.find((o) => o.id === value)?.id ?? fallback;

export async function getSettings(): Promise<Settings> {
  const { apiKey, model, language, length, style } = await browser.storage.local.get([
    'apiKey',
    'model',
    'language',
    'length',
    'style',
  ]);
  return {
    apiKey: typeof apiKey === 'string' ? apiKey : '',
    model: pick(MODELS, model, DEFAULT_MODEL),
    language: pick(LANGUAGES, language, DEFAULT_PREFS.language),
    length: pick(LENGTHS, length, DEFAULT_PREFS.length),
    style: pick(STYLES, style, DEFAULT_PREFS.style),
  };
}

export function samePrefs(a: SummaryPrefs, b: SummaryPrefs): boolean {
  return a.language === b.language && a.length === b.length && a.style === b.style;
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
  | { status: 'done'; title: string; summary: Summary; prefs?: SummaryPrefs; updatedAt: number }
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
