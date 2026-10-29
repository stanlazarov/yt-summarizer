import { MessageError, onMessages, type Transcript } from '@/lib/messages';
import {
  extractPlayerResponse,
  json3Url,
  PANEL_SEGMENT_SELECTOR,
  parseJson3,
  parsePanelRows,
  pickCaptionTrack,
  readPanelRows,
  readVideoInfo,
  videoIdFromUrl,
  type Segment,
  type VideoInfo,
} from '@/lib/transcript';

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  main() {
    onMessages({
      getTranscript: ({ videoId }) => getTranscript(videoId),
      seek: async ({ seconds }) => {
        const video = document.querySelector<HTMLVideoElement>('video');
        if (!video) throw new MessageError({ message: 'No video found on this page.' });
        video.currentTime = seconds;
        void video.play();
      },
      getPlayback: async ({ videoId }) => {
        if (videoIdFromUrl(location.href) !== videoId) return null;
        // During an ad, <video> plays the ad and its currentTime is the ad's.
        if (document.querySelector('#movie_player.ad-showing')) return null;
        const video = document.querySelector<HTMLVideoElement>('#movie_player video') ?? document.querySelector('video');
        return video ? { seconds: video.currentTime } : null;
      },
    });
  },
});

async function getTranscript(videoId: string): Promise<Transcript> {
  // Fetch a fresh copy of the watch page: the page's own
  // ytInitialPlayerResponse goes stale after in-app navigation.
  let info: VideoInfo = { title: '', durationSec: 0, tracks: [] };
  try {
    const html = await (await fetch(`https://www.youtube.com/watch?v=${videoId}`)).text();
    info = readVideoInfo(extractPlayerResponse(html));
  } catch (err) {
    console.warn('[yt-summarizer] watch page fetch failed', err);
  }

  let segments = await fromCaptionTrack(info).catch((err: unknown) => {
    console.warn('[yt-summarizer] caption track failed', err);
    return [] as Segment[];
  });
  if (segments.length === 0) segments = await fromTranscriptPanel(videoId);
  if (segments.length === 0) throw new MessageError({ message: 'This video has no transcript.' });

  return {
    videoId,
    title: info.title || document.title.replace(/ - YouTube$/, ''),
    // Not <video>.duration: during an ad it's the ad's length.
    durationSec: info.durationSec,
    segments,
  };
}

async function fromCaptionTrack(info: VideoInfo): Promise<Segment[]> {
  const track = pickCaptionTrack(info.tracks, navigator.language);
  if (!track) return [];
  const res = await fetch(json3Url(track));
  const body = await res.text();
  // Caption requests that need a proof-of-origin token come back empty.
  if (!res.ok || !body) return [];
  return parseJson3(JSON.parse(body));
}

/**
 * Fallback: open "Show transcript" under the description and scrape the panel.
 * In practice this is the main path: on 2026-10-29 caption-track requests came
 * back empty without a proof-of-origin token.
 *
 * The panel is opened invisibly and closed again afterwards, so the user never
 * sees it. A panel the user opened themselves is read and left alone.
 */
async function fromTranscriptPanel(videoId: string): Promise<Segment[]> {
  if (videoIdFromUrl(location.href) !== videoId) return [];
  const userOpened = [...document.querySelectorAll(TRANSCRIPT_PANEL)].some(
    (p) => p.getAttribute('visibility') === EXPANDED && p.querySelector(PANEL_SEGMENT_SELECTOR),
  );
  if (userOpened) return parsePanelRows(readPanelRows(document));

  // The section can render twice (one copy hidden, depending on layout).
  const buttons = [
    ...document.querySelectorAll<HTMLElement>('ytd-video-description-transcript-section-renderer button'),
  ];
  const button = buttons.find((b) => b.offsetParent !== null) ?? buttons[0];
  if (!button) return [];

  const hide = hideTranscriptPanel();
  try {
    button.click();
    if (!(await waitFor(PANEL_SEGMENT_SELECTOR, 10000))) return [];
    await waitForStableCount(PANEL_SEGMENT_SELECTOR);
    return parsePanelRows(readPanelRows(document));
  } finally {
    await closeTranscriptPanel();
    hide.remove();
  }
}

const TRANSCRIPT_PANEL =
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"], ' +
  'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]';
const EXPANDED = 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
const HIDDEN = 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN';

/**
 * Makes the transcript panel invisible without moving it off-screen: YouTube
 * only loads the transcript while the panel is in the viewport.
 */
function hideTranscriptPanel(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `${TRANSCRIPT_PANEL} {
    position: fixed !important; top: 0 !important; left: 0 !important;
    opacity: 0 !important; pointer-events: none !important; z-index: -1 !important;
  }`;
  document.head.append(style);
  return style;
}

async function closeTranscriptPanel(): Promise<void> {
  for (const panel of document.querySelectorAll<HTMLElement>(TRANSCRIPT_PANEL)) {
    if (panel.getAttribute('visibility') !== EXPANDED) continue;
    const close = panel.querySelector<HTMLElement>(
      'ytd-engagement-panel-title-header-renderer #visibility-button button, button[aria-label="Close"]',
    );
    if (close) close.click();
    else panel.setAttribute('visibility', HIDDEN);
  }
  // Keep the panel hidden until YouTube has finished closing it.
  const start = Date.now();
  while (Date.now() - start < 1000 && document.querySelector(`:is(${TRANSCRIPT_PANEL})[visibility="${EXPANDED}"]`)) {
    await sleep(50);
  }
}

/** Waits until the number of matches stops changing, since long transcripts render in batches. */
async function waitForStableCount(selector: string, quietMs = 400, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  let count = document.querySelectorAll(selector).length;
  let changedAt = Date.now();
  while (Date.now() - changedAt < quietMs && Date.now() - start < timeoutMs) {
    await sleep(100);
    const next = document.querySelectorAll(selector).length;
    if (next !== count) {
      count = next;
      changedAt = Date.now();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(selector: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) return resolve(true);
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(true);
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeoutMs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
