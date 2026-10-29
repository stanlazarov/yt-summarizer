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
 */
async function fromTranscriptPanel(videoId: string): Promise<Segment[]> {
  if (videoIdFromUrl(location.href) !== videoId) return [];
  if (!document.querySelector(PANEL_SEGMENT_SELECTOR)) {
    // The section can render twice (one copy hidden, depending on layout).
    const buttons = [
      ...document.querySelectorAll<HTMLElement>('ytd-video-description-transcript-section-renderer button'),
    ];
    const button = buttons.find((b) => b.offsetParent !== null) ?? buttons[0];
    if (!button) return [];
    button.click();
    if (!(await waitFor(PANEL_SEGMENT_SELECTOR, 10000))) return [];
  }
  return parsePanelRows(readPanelRows(document));
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
