# Test fixtures

YouTube changes these structures without notice. When something breaks, save a
new fixture from a real page *before* changing the parser.

| File | Source |
|---|---|
| `watch-manual-captions.html` | Real watch page for `jNQXAC9IVRw` (2026-10-29), trimmed to the `ytInitialPlayerResponse` script with `captions` + `videoDetails` kept. A `"};"` string is appended to the description to exercise the string-aware brace scanner. |
| `watch-many-tracks.html` | Same, for `dQw4w9WgXcQ`: manual + auto-generated (`asr`) tracks in several languages. |
| `watch-no-captions.html` | `watch-manual-captions.html` with `captions` removed. |
| `json3-auto-captions.json` | Hand-written in YouTube's json3 shape (window events with no `segs`, `aAppend` newline events, multi-seg events). Real timedtext requests returned empty bodies without a proof-of-origin token on 2026-10-29, so no real capture exists yet. |
| `panel-legacy.html` | Transcript panel `ytd-transcript-segment-list-renderer` from `xAcTmDO6NTI` (2026-10-29), first 5 segments, Polymer comments/templates stripped. |
| `panel-view-model.html` | Newer transcript panel (`transcript-segment-view-model`, grouped by chapter) from `jNQXAC9IVRw` (2026-10-29), inline styles stripped. |
