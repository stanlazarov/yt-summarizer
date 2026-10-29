// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractPlayerResponse,
  formatTranscript,
  json3Url,
  mergeSegments,
  parseJson3,
  parsePanelRows,
  pickCaptionTrack,
  readPanelRows,
  readVideoInfo,
  videoIdFromUrl,
  type CaptionTrack,
} from '../lib/transcript';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('videoIdFromUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?si=x', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/', null],
    ['https://www.youtube.com/watch?v=short', null],
    ['https://example.com/watch?v=dQw4w9WgXcQ', null],
    ['not a url', null],
    [undefined, null],
  ])('%s → %s', (url, id) => expect(videoIdFromUrl(url)).toBe(id));
});

describe('watch page', () => {
  it('extracts title, duration, and tracks', () => {
    const info = readVideoInfo(extractPlayerResponse(fixture('watch-manual-captions.html')));
    expect(info.title).toBe('Me at the zoo');
    expect(info.durationSec).toBe(19);
    expect(info.tracks.map((t) => [t.languageCode, t.kind])).toEqual([
      ['en', undefined],
      ['de', undefined],
    ]);
    expect(info.tracks[0]!.baseUrl).toMatch(/^https:\/\/www\.youtube\.com\/api\/timedtext\?/);
  });

  it('survives "};" inside JSON strings', () => {
    const pr = extractPlayerResponse(fixture('watch-manual-captions.html')) as {
      videoDetails: { shortDescription: string };
    };
    expect(pr.videoDetails.shortDescription).toContain('"};"');
  });

  it('finds auto-generated tracks', () => {
    const info = readVideoInfo(extractPlayerResponse(fixture('watch-many-tracks.html')));
    expect(info.durationSec).toBe(213);
    expect(info.tracks.some((t) => t.kind === 'asr')).toBe(true);
    expect(info.tracks.length).toBeGreaterThan(3);
  });

  it('returns no tracks for a video without captions', () => {
    const info = readVideoInfo(extractPlayerResponse(fixture('watch-no-captions.html')));
    expect(info.title).toBe('Me at the zoo');
    expect(info.tracks).toEqual([]);
  });

  it('returns null when there is no player response', () => {
    expect(extractPlayerResponse('<html><body>consent page</body></html>')).toBeNull();
    expect(readVideoInfo(null)).toEqual({ title: '', durationSec: 0, tracks: [] });
  });
});

describe('pickCaptionTrack', () => {
  const track = (languageCode: string, kind?: string): CaptionTrack => ({
    baseUrl: `https://www.youtube.com/api/timedtext?lang=${languageCode}`,
    languageCode,
    kind,
  });

  it('prefers manual captions in the UI language', () => {
    const tracks = [track('de'), track('en', 'asr'), track('en-GB')];
    expect(pickCaptionTrack(tracks, 'en-US')).toBe(tracks[2]);
  });

  it('then auto-generated captions', () => {
    const tracks = [track('de'), track('fr', 'asr')];
    expect(pickCaptionTrack(tracks, 'en-US')).toBe(tracks[1]);
  });

  it('then any manual track', () => {
    const tracks = [track('de'), track('fr')];
    expect(pickCaptionTrack(tracks, 'en')).toBe(tracks[0]);
  });

  it('returns null with no tracks', () => {
    expect(pickCaptionTrack([], 'en')).toBeNull();
  });

  it('works on a real track list', () => {
    const info = readVideoInfo(extractPlayerResponse(fixture('watch-many-tracks.html')));
    const picked = pickCaptionTrack(info.tracks, 'en-US')!;
    expect(picked.languageCode).toBe('en');
    expect(picked.kind).toBeUndefined();
  });
});

describe('json3', () => {
  it('builds the json3 URL', () => {
    const url = new URL(json3Url({ baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en' }));
    expect(url.searchParams.get('fmt')).toBe('json3');
    expect(url.searchParams.get('v')).toBe('x');
  });

  it('parses events, skipping window events and blank appends', () => {
    expect(parseJson3(JSON.parse(fixture('json3-auto-captions.json')))).toEqual([
      { startSec: 0.12, text: 'all right so here' },
      { startSec: 2.11, text: 'we are in front of the elephants' },
      { startSec: 7.4, text: 'the cool thing about these guys' },
      { startSec: 16.2, text: "and that's pretty much all there is to say" },
    ]);
  });

  it('returns [] for unexpected input', () => {
    expect(parseJson3(null)).toEqual([]);
    expect(parseJson3({})).toEqual([]);
  });
});

describe('transcript panel', () => {
  const panel = (name: string) => {
    const root = document.createElement('div');
    root.innerHTML = fixture(name);
    return root;
  };

  it('reads the legacy ytd-transcript-segment-renderer markup', () => {
    const segments = parsePanelRows(readPanelRows(panel('panel-legacy.html')));
    expect(segments).toHaveLength(5);
    expect(segments[0]).toEqual({ startSec: 0, text: '[SQUEAKING] [RUSTLING] [CLICKING]' });
    expect(segments[1]).toEqual({
      startSec: 16,
      text: 'ANA BELL: All right, so welcome to the first lecture of 6.100L.',
    });
    expect(segments.at(-1)!.startSec).toBe(33);
  });

  it('reads the transcript-segment-view-model markup (ignoring chapter headers and a11y labels)', () => {
    expect(parsePanelRows(readPanelRows(panel('panel-view-model.html')))).toEqual([
      {
        startSec: 1,
        text: 'All right, so here we are, in front of the elephants the cool thing about these guys is that they have really...',
      },
      { startSec: 7, text: "really really long trunks and that's cool (baaaaaaaaaaahhh!!)" },
      { startSec: 16, text: "and that's pretty much all there is to say" },
    ]);
  });

  it('returns [] when no panel is rendered', () => {
    expect(readPanelRows(document.createElement('div'))).toEqual([]);
  });

  it('drops rows with bad timestamps or empty text', () => {
    expect(
      parsePanelRows([
        { timestamp: 'Chapter 1', text: 'x' },
        { timestamp: '1:00', text: '   ' },
        { timestamp: ' 1:02:03 ', text: ' hi ' },
      ]),
    ).toEqual([{ startSec: 3723, text: 'hi' }]);
  });
});

describe('prompt formatting', () => {
  it('merges segments into ~15s chunks and formats [m:ss] lines', () => {
    const segments = [
      { startSec: 0, text: 'a' },
      { startSec: 5, text: 'b' },
      { startSec: 14.9, text: 'c' },
      { startSec: 15, text: 'd' },
      { startSec: 3700, text: 'e' },
    ];
    const chunks = mergeSegments(segments);
    expect(chunks).toEqual([
      { startSec: 0, text: 'a b c' },
      { startSec: 15, text: 'd' },
      { startSec: 3700, text: 'e' },
    ]);
    expect(formatTranscript(chunks)).toBe('[0:00] a b c\n[0:15] d\n[1:01:40] e');
  });

  it('does not mutate its input', () => {
    const segments = [
      { startSec: 0, text: 'a' },
      { startSec: 1, text: 'b' },
    ];
    mergeSegments(segments);
    expect(segments[0]!.text).toBe('a');
  });
});
