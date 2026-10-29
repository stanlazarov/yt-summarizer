# YouTube Summarizer

A Chrome extension that summarizes the YouTube video you're watching using Claude. Click the toolbar icon on any video to get:

- **TL;DR**: a short overview
- **Key points**: the main takeaways
- **Timestamped sections**: a chapter-style breakdown. Click a timestamp to jump to that part of the video.

In Options you can choose the summary's language, its length (brief, standard, or detailed), and its style (notes, bullets, or ELI5).

You use your own Anthropic API key, and there's no server in between.

> **Status: feature implementation.** The core extension works end to end against the Claude API, and features are being added. See [`docs/PLAN.md`](docs/PLAN.md) for the build checklist.

## Requirements

- [Node.js](https://nodejs.org) 20 or newer
- Google Chrome (or another Chromium browser: Edge, Brave, Arc)
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

## How to run

### Development

```bash
npm install
npm run dev
```

`npm run dev` opens a separate Chrome window with the extension already loaded. Code changes reload automatically.

### Install manually (production build)

```bash
npm run build
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder.
4. Optionally, pin the extension from the puzzle-piece menu so the icon is always visible.

### First-time setup

1. Right-click the extension icon and choose **Options**.
2. Paste your Anthropic API key and save.
3. Optionally, pick a model. **Claude Haiku 5.5** is the default: fast and cheap. **Claude Sonnet 5.5** handles long or dense videos better.

## Usage

1. Open any YouTube video that has captions (manual or auto-generated).
2. Click the extension icon.
3. Wait a few seconds for the summary. You can close the popup in the meantime, and the summary keeps generating.
4. Click a section's timestamp to seek the video to that point.

## Cost

Each summary is one API call billed to your Anthropic account. A 1-hour video costs roughly:

| Model | Approx. cost per summary |
|---|---|
| Claude Haiku 5.5 (default) | ~$0.002 |
| Claude Sonnet 5.5 | ~$0.05 |

## Privacy

- Your API key is stored only in this browser's local extension storage. It isn't synced or sent anywhere except Anthropic's API.
- The video's transcript is sent to Anthropic's API to generate the summary. Nothing else leaves your browser, and there's no analytics.

## Troubleshooting

| Problem | Fix |
|---|---|
| "This video has no transcript" | The video has no captions. Videos without captions can't be summarized. |
| "Invalid API key, check Options" | Re-paste the key in Options and make sure it's active in the Anthropic Console. |
| "Rate limited" | Wait a moment and try again, or check your account's rate limits. |
| "Couldn't summarize this video" | Switch to Sonnet 5.5 in Options and try again. |
| "Reload the YouTube tab and try again" | The tab was open before the extension was installed or updated. Reload it. |
| Summary is for the wrong video | Click **Re-summarize**. If it keeps happening, reload the YouTube tab. |
| Nothing happens on click | Make sure the tab is a `youtube.com/watch` page. Then check `chrome://extensions` → the extension → **Errors**. |

## Development

```bash
npx vitest                    # run unit tests
npm run compile               # type-check
npm run build                 # production build
node scripts/make-icons.mjs   # regenerate the toolbar icons
```

Project conventions are in [`CLAUDE.md`](CLAUDE.md).
