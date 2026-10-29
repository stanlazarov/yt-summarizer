// Pure parsing for YouTube transcripts. No DOM, no fetch: everything here is
// tested against saved fixtures in tests/fixtures. YouTube changes these
// structures without notice, so add a fixture before changing a parser.

import { formatTimestamp, parseTimestamp } from './time';

export interface Segment {
  startSec: number;
  text: string;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" for auto-generated
  name?: string;
}

export interface VideoInfo {
  title: string;
  durationSec: number;
  tracks: CaptionTrack[];
}

/** Extracts the video ID from a watch, shorts, live, or youtu.be URL. */
export function videoIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const id =
    u.hostname === 'youtu.be'
      ? u.pathname.slice(1)
      : u.hostname.endsWith('youtube.com')
        ? u.pathname === '/watch'
          ? u.searchParams.get('v')
          : /^\/(shorts|live)\/([^/]+)/.exec(u.pathname)?.[2]
        : null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/**
 * Finds `ytInitialPlayerResponse = {...}` in watch-page HTML and returns the
 * parsed object. Scans braces (string-aware) instead of relying on a regex for
 * the terminator, since the JSON contains `};` sequences inside strings.
 */
export function extractPlayerResponse(html: string): unknown | null {
  const marker = /ytInitialPlayerResponse\s*=\s*\{/.exec(html);
  if (!marker) return null;
  const start = marker.index + marker[0].length - 1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Pulls title, duration, and caption tracks out of a player response. */
export function readVideoInfo(playerResponse: unknown): VideoInfo {
  const pr = playerResponse as {
    videoDetails?: { title?: string; lengthSeconds?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{
          baseUrl?: string;
          languageCode?: string;
          kind?: string;
          name?: { simpleText?: string; runs?: Array<{ text?: string }> };
        }>;
      };
    };
  } | null;
  const rawTracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const tracks: CaptionTrack[] = rawTracks
    .filter((t) => typeof t.baseUrl === 'string' && typeof t.languageCode === 'string')
    .map((t) => ({
      baseUrl: t.baseUrl!,
      languageCode: t.languageCode!,
      kind: t.kind,
      name: t.name?.simpleText ?? t.name?.runs?.map((r) => r.text ?? '').join(''),
    }));
  return {
    title: pr?.videoDetails?.title ?? '',
    durationSec: Number(pr?.videoDetails?.lengthSeconds) || 0,
    tracks,
  };
}

/**
 * Picks the best caption track: manual captions in the UI language, then
 * auto-generated captions, then any manual track, then anything.
 */
export function pickCaptionTrack(tracks: CaptionTrack[], uiLanguage: string): CaptionTrack | null {
  const lang = uiLanguage.toLowerCase().split('-')[0];
  const isManual = (t: CaptionTrack) => t.kind !== 'asr';
  const inLang = (t: CaptionTrack) => t.languageCode.toLowerCase().split('-')[0] === lang;
  return (
    tracks.find((t) => isManual(t) && inLang(t)) ??
    tracks.find((t) => !isManual(t)) ??
    tracks.find(isManual) ??
    tracks[0] ??
    null
  );
}

/** Builds the json3 caption URL for a track. */
export function json3Url(track: CaptionTrack): string {
  const url = new URL(track.baseUrl, 'https://www.youtube.com');
  url.searchParams.set('fmt', 'json3');
  return url.toString();
}

/** Parses YouTube's json3 caption format into segments. */
export function parseJson3(json: unknown): Segment[] {
  const events = (json as { events?: unknown[] } | null)?.events;
  if (!Array.isArray(events)) return [];
  const segments: Segment[] = [];
  for (const ev of events as Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }>) {
    if (!ev.segs || typeof ev.tStartMs !== 'number') continue;
    const text = cleanText(ev.segs.map((s) => s.utf8 ?? '').join(''));
    if (text) segments.push({ startSec: ev.tStartMs / 1000, text });
  }
  return segments;
}

/**
 * Transcript panel markups YouTube serves (both seen on 2026-10-29, varying by
 * video/experiment). Add new ones here, newest first.
 */
const PANEL_MARKUPS = [
  {
    segment: 'transcript-segment-view-model',
    timestamp: '.ytwTranscriptSegmentViewModelTimestamp',
    text: '.ytAttributedStringHost',
  },
  { segment: 'ytd-transcript-segment-renderer', timestamp: '.segment-timestamp', text: '.segment-text' },
];

/** Selector that matches a transcript segment in any known markup. */
export const PANEL_SEGMENT_SELECTOR = PANEL_MARKUPS.map((m) => m.segment).join(', ');

/** Reads `{timestamp, text}` rows from a rendered transcript panel. */
export function readPanelRows(root: ParentNode): Array<{ timestamp: string; text: string }> {
  for (const markup of PANEL_MARKUPS) {
    const rows = [...root.querySelectorAll(markup.segment)].map((el) => ({
      timestamp: el.querySelector(markup.timestamp)?.textContent ?? '',
      text: el.querySelector(markup.text)?.textContent ?? '',
    }));
    if (rows.length > 0) return rows;
  }
  return [];
}

/** Converts rows scraped from the transcript panel ("1:15", "text") into segments. */
export function parsePanelRows(rows: Array<{ timestamp: string; text: string }>): Segment[] {
  const segments: Segment[] = [];
  for (const row of rows) {
    const startSec = parseTimestamp(row.timestamp);
    const text = cleanText(row.text);
    if (startSec !== null && text) segments.push({ startSec, text });
  }
  return segments;
}

/** Merges consecutive segments into chunks spanning roughly `spanSec` seconds. */
export function mergeSegments(segments: Segment[], spanSec = 15): Segment[] {
  const chunks: Segment[] = [];
  let current: Segment | null = null;
  for (const seg of segments) {
    if (current && seg.startSec - current.startSec < spanSec) {
      current.text += ' ' + seg.text;
    } else {
      current = { startSec: seg.startSec, text: seg.text };
      chunks.push(current);
    }
  }
  return chunks;
}

/** Renders chunks as `[mm:ss] text` lines for the prompt. */
export function formatTranscript(chunks: Segment[]): string {
  return chunks.map((c) => `[${formatTimestamp(c.startSec)}] ${c.text}`).join('\n');
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
