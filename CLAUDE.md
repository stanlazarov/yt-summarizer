# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

A Chrome (Manifest V3) extension that summarizes the YouTube video in the current tab. The user brings their own Anthropic API key. The extension calls the Claude API directly, with no backend. The summary shows in Chrome's side panel (opened from the toolbar icon) as a TL;DR, key points, and timestamped sections; clicking a timestamp seeks the video.

**Status:** feature implementation. Checklist steps 1–5 are implemented, unit-tested, and verified end to end against the Claude API; features are being added on top. See [`docs/PLAN.md`](docs/PLAN.md).

## Stack

- [WXT](https://wxt.dev) (Vite-based extension framework) + TypeScript (strict)
- `@anthropic-ai/sdk` + `zod` for the Claude call and structured output
- Vanilla TS + CSS for the side panel and options UI (no framework)
- Vitest for unit tests (happy-dom for the transcript-panel parser)

## Commands

```bash
npm install        # install dependencies
npm run dev        # launch Chrome with the extension loaded + hot reload
npm run build      # production build → .output/chrome-mv3
npx vitest         # run unit tests
npm run compile    # type-check
```

## Architecture

```
side panel ──(getSummary videoId)──▶ background service worker ──▶ Claude API
  │                                        │
  │                                        └─(getTranscript)──▶ content script (youtube.com)
  └─(seek / getPlayback)──▶ content script ──▶ <video>.currentTime
```

- **Side panel** (`entrypoints/sidepanel/`): stateless. It follows the window's active tab and in-page YouTube navigations; for each video it reads state from `chrome.storage.session` and asks the background to start a summary if none exists. While a summary is shown it polls `getPlayback` once a second (skipped while hidden) to highlight the section that's playing. Styled with YouTube's own palette (light/dark) so it sits naturally next to the page; `options/` reuses its stylesheet.
- **Background** (`entrypoints/background.ts`): orchestrates transcript → summarize → `chrome.storage.session` (keyed by videoId). A summary keeps running after the panel closes. On startup it sets the toolbar icon to open the side panel.
- **Content script** (`entrypoints/youtube.content.ts`): extracts the transcript and handles seek requests.
- **Options** (`entrypoints/options/`): API key and model selection.

## Layout

```
entrypoints/   background.ts, youtube.content.ts, sidepanel/, options/
lib/           transcript.ts, summarize.ts, messages.ts, storage.ts, time.ts, usage.ts
tests/         vitest tests + fixtures (saved watch-page HTML, transcript-panel HTML, json3 captions)
scripts/       make-icons.mjs (generates public/icon/*.png)
docs/          PLAN.md
```

## Conventions

- **Messages between contexts** are typed in `lib/messages.ts`. Add a type there before sending any new message, and don't use untyped `chrome.runtime.sendMessage` payloads.
- **Storage** goes through the typed wrappers in `lib/storage.ts`.
  - The API key lives only in `chrome.storage.local`. Never use `storage.sync`, never log the key, and never put it in a URL.
  - Per-video summary state lives in `chrome.storage.session`.
- **Model:** the default is `claude-haiku-5-5`, with Sonnet 5.5 (`claude-sonnet-5-5`) as the option for harder videos. Summarization doesn't need a bigger model, so don't change the default without a concrete quality reason.
  - Use exact model IDs only, with no date suffixes.
- **Claude API usage** (see `lib/summarize.ts`):
  - Create the client with `dangerouslyAllowBrowser: true`. That's acceptable here because the key belongs to the user.
  - Use structured output via `output_config.format` + `zodOutputFormat`. Don't use assistant prefill, `temperature`, or `budget_tokens`; current models reject them.
  - Set effort explicitly in `output_config.effort`.
  - Always check `stop_reason`, including `"refusal"`, before reading content.
  - Send server-side fallbacks (`fallbacks: "default"`) only for Sonnet; Haiku has none.
- **Transcript extraction is fragile.** It depends on YouTube's internal page structure, which changes without notice.
  - Keep parsing logic in pure functions in `lib/transcript.ts`, separate from DOM and fetch code.
  - Test those functions against saved fixtures. `tests/fixtures/README.md` records where each one came from.
  - In practice the transcript panel is the main path. As of 2026-10-29, caption-track (timedtext) requests return empty bodies without a proof-of-origin token, and YouTube serves two different panel markups (see `PANEL_MARKUPS`).
  - When YouTube breaks something, add a new fixture before fixing it.
- **Errors shown to users** must be actionable ("Invalid API key, check Options"), not raw API errors.
- Keep the UI small and dependency-free.
