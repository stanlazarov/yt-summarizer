# Design & Build Plan

## Goal

A simple Chrome extension: open a YouTube video, click the toolbar icon, and get a summary of the video. The summary has:

- **TL;DR**: a short paragraph
- **Key points**: 3–8 bullets
- **Timestamped sections**: a chapter-style breakdown. Clicking a timestamp seeks the video.

### Decisions

| Topic | Choice | Why |
|---|---|---|
| Browser | Chrome/Chromium, Manifest V3 | Largest user base; also covers Edge, Brave, Arc |
| LLM access | Bring your own Anthropic API key | No server to host; the user controls cost |
| UI | Toolbar popup | Simplest surface; nothing is injected into YouTube's page |
| Model | `claude-haiku-5-5` (default), `claude-sonnet-5-5` (option) | Summarization is a routine task. Haiku is cheap and fast. |
| Tooling | WXT + TypeScript, vanilla UI | Manifest generation, hot reload, bundling for SDK + Zod |

### Out of scope (for now)

- Firefox support
- Ask follow-up questions about the video
- Persistent summary cache across browser sessions
- Transcribing audio of videos with no captions
- A hosted backend or a Chrome Web Store release

## Architecture

```
popup ──(getSummary videoId)──▶ background service worker ──▶ Claude API
  │                                   │
  │                                   └─(getTranscript)──▶ content script (youtube.com)
  └─(seek seconds)──▶ content script ──▶ <video>.currentTime
```

- **Popup**
  1. Reads the active tab's URL and extracts the video ID.
  2. Reads `chrome.storage.session[videoId]`. If it's empty, asks the background to start a summary.
  3. Renders one of the states `loading | done | error`, updating through `chrome.storage.onChanged`.

  The popup holds no state of its own because Chrome closes it as soon as it loses focus.
- **Background service worker**
  1. Receives `getSummary`.
  2. Asks the tab's content script for the transcript.
  3. Calls Claude.
  4. Writes `{status, summary | error, updatedAt}` to `chrome.storage.session`.

  A pending `fetch` keeps the MV3 worker alive for the duration of the call.
- **Content script** (`*://www.youtube.com/*`) answers `getTranscript` and `seek`.
- **Options page** stores the API key (`chrome.storage.local`) and the selected model.

### Manifest

- `permissions`: `storage`, `activeTab`
- `host_permissions`: `*://www.youtube.com/*`, `https://api.anthropic.com/*`

## Transcript extraction

This is the main technical risk, so it's the first thing to build and test.

1. **Primary: caption tracks from the watch page.**
   1. Fetch `https://www.youtube.com/watch?v=<id>` and extract the `ytInitialPlayerResponse` JSON from the HTML. Don't read the page's own copy of that variable: YouTube navigates as a single-page app, so it goes stale.
   2. Read `captions.playerCaptionsTracklistRenderer.captionTracks`. Pick manually created captions in the UI language first, then auto-generated (`kind: "asr"`), then any track.
   3. Fetch `baseUrl + "&fmt=json3"` and parse `events[].segs` into `{ startSec, text }[]`.
2. **Fallback: the transcript panel in the DOM.** If step 1 returns nothing, open "Show transcript" under the description and read the `ytd-transcript-segment-renderer` elements (timestamp + text).
3. **No captions:** fail with "This video has no transcript."

**Prompt format:** `[mm:ss] text` lines, with segments merged into roughly 10–20 second chunks to save tokens. A 1-hour video is about 15k tokens, well within the context window, so no chunking or map-reduce is needed.

## Summarization

`lib/summarize.ts`:

```ts
const Summary = z.object({
  tldr: z.string(),
  key_points: z.array(z.string()),          // prompt asks for 3–8
  sections: z.array(z.object({
    start_seconds: z.number(),
    title: z.string(),
    summary: z.string(),
  })),
});
```

### Request

- `client.messages.parse({ model, max_tokens: 16000, system, messages, output_config: { format: zodOutputFormat(Summary), effort: "medium" } })`
- Use `client.beta.messages` with `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"` only when Sonnet 5.5 is selected. Haiku has no server-side fallback.
- Client: `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`

### System prompt

- Summarize only what the transcript says, without adding outside facts.
- Section start times must be taken from the transcript's timestamps.
- Write in the transcript's language, or in the language chosen in Options.
- Length (brief / standard / detailed; standard is the default) sets how long the TL;DR is and how many key points and sections there are. Style (notes / bullets / ELI5) sets the tone. The output schema is the same for all of them, so the popup doesn't change. `buildSystemPrompt(prefs)` in `lib/summarize.ts` is pure and unit-tested.
- A cached summary stores the prefs it was made with. If the prefs no longer match, the background makes a new one.

### Post-processing

- Drop sections whose `start_seconds` falls outside `[0, duration]`.
- Sort sections by start time.

### Error mapping

| Condition | Message to user |
|---|---|
| 401 | "Invalid API key, check Options" |
| 429 | "Rate limited, try again in a moment" |
| 5xx / network | "Couldn't reach Claude, try again" |
| `stop_reason: "refusal"` | "Couldn't summarize this video. Try Sonnet in Options." |
| `stop_reason: "max_tokens"` / parse failure | "Summary was incomplete, try again" |
| No transcript | "This video has no transcript" |
| No API key | "Add your API key in Options" (with a link) |

### Cost estimate (1-hour video: ~15k input, ~1.5k output tokens)

| Model | Approx. cost per summary |
|---|---|
| Haiku 5.5 | ~$0.002 |
| Sonnet 5.5 | ~$0.05 |

## Files

```
wxt.config.ts
package.json
tsconfig.json
entrypoints/
  background.ts          # message router + orchestration
  youtube.content.ts     # getTranscript + seek
  popup/index.html, main.ts, style.css
  options/index.html, main.ts
lib/
  transcript.ts          # watch-page parsing, track selection, json3 parsing, DOM fallback
  summarize.ts           # Claude client, schema, prompt, error mapping
  messages.ts            # typed message contracts
  storage.ts             # typed chrome.storage wrappers
  time.ts                # mm:ss formatting/parsing
tests/
  transcript.test.ts
  fixtures/              # saved watch-page HTML + json3 caption files
```

## Build checklist

- [x] **1. Scaffold.** WXT + TypeScript project and a manifest with the permissions above. The extension loads in Chrome via `npm run dev`.
- [x] **2. Transcript spike.** Content script + `lib/transcript.ts`. Log the transcript for several real videos (manual captions, auto captions, none). Save fixtures and write the Vitest tests.
- [x] **3. Options page.** API key input (masked), model select, and a "Test key" button.
- [x] **4. Summarization.** `lib/summarize.ts` + background orchestration + session storage.
- [x] **5. Popup UI.** Loading, done, and error states; clickable timestamps; a "Re-summarize" button.
- [ ] **6. Polish.** A message when the tab isn't a video page, a badge while a summary is in progress, and the README updated with screenshots. *(Not-a-video message and badge are done; screenshots are still needed.)*

## Verification

- `npx vitest` passes the transcript parsing tests against the fixtures.
- Manual tests in `npm run dev`:
  - A video with manual captions → summary with sensible sections
  - Only auto-generated captions → summary works
  - No captions → the "no transcript" error
  - A video over 1 hour → completes, and timestamps stay within the video's length
  - Navigating between videos without a reload → the summary matches the current video
  - Closing the popup mid-summary and reopening it → shows the in-progress state, then the result
  - Clicking a timestamp → the video seeks to it
  - An invalid key → the "check Options" hint
- `npm run build` → "Load unpacked" from `.output/chrome-mv3` works in a fresh Chrome profile.

## Findings from the transcript spike (2026-10-29)

- **The primary path is currently dead.** The watch page still lists `captionTracks`, but `timedtext` requests return `200` with an empty body (the URLs carry `exp=xpe`, and no `pot` token is provided). This happens from inside youtube.com with cookies too. The innertube `get_transcript` endpoint returns `400 FAILED_PRECONDITION`. The code keeps the primary path, which costs one request and recovers automatically if YouTube relaxes this.
- **The DOM panel works, in two markups.** Some videos render `ytd-transcript-segment-renderer` and others render `transcript-segment-view-model`, which is grouped under chapter headers. Both are handled and covered by fixtures. On a 1h03m video, the legacy panel rendered all 573 segments at once, with no virtualization.
- The page renders the "Show transcript" button twice, and one copy can be hidden depending on layout.
- `<video>.duration` reports the ad's length while an ad plays, so the duration comes only from the watch page's `videoDetails.lengthSeconds`.

## Open questions / risks

- **YouTube caption access changes.** YouTube has started requiring proof-of-origin tokens on some caption requests. If the primary path fails, the DOM fallback depends on the transcript panel's markup, which can also change. Mitigation: two independent strategies, fixture-based tests, and clear errors.
- **Very long videos (3h+).** These still fit in the context window, but the cost on Sonnet and the response time grow. Possible later work: a progress indicator, a length warning before summarizing, or summarizing in chunks.
- **API key storage.** `chrome.storage.local` isn't encrypted. That's acceptable for a personal BYOK tool. A public release would need a backend.
- **Persistent cache.** Session storage is cleared when the browser restarts. If re-summarizing turns out to be annoying, move finished summaries to `chrome.storage.local` with an LRU cap.
