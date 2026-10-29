// Stateless: everything comes from chrome.storage.session, so the panel can be
// closed and reopened mid-summary. Unlike a popup it stays open, so it follows
// the window's active tab and YouTube's in-page navigations.

import { browser } from 'wxt/browser';
import { sendToBackground, sendToTab, toUserError } from '@/lib/messages';
import { getSummaryState, watchSummaryState, type SummaryState, type UserError } from '@/lib/storage';
import type { Summary } from '@/lib/summarize';
import { formatCost, formatTokens, type SummaryUsage } from '@/lib/usage';
import { currentSectionIndex, formatTimestamp } from '@/lib/time';
import { videoIdFromUrl } from '@/lib/transcript';
import { icon } from './icons';

const DEFAULT_TITLE = 'YouTube Summarizer';
/** How often the panel asks the page where playback is, to highlight the current section. */
const PLAYBACK_POLL_MS = 1000;

const content = document.getElementById('content')!;
const titleEl = document.getElementById('title')!;
document.getElementById('brand')!.append(icon('logo'));
document.getElementById('options')!.append(icon('settings'));
document.getElementById('options')!.addEventListener('click', () => browser.runtime.openOptionsPage());

/** Stops the playback polling started by the summary currently on screen. */
let stopTracking: (() => void) | undefined;

/** The video the panel is showing. Replaced (and the old watcher dropped) when the active tab changes video. */
let current: { videoId: string; tabId: number; titled: boolean; unwatch: () => void } | undefined;

browser.tabs.onActivated.addListener(() => void refresh());
browser.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url) void refresh();
  // YouTube updates the tab title after the URL; use it until the summary brings the real one.
  else if (change.title && current?.tabId === tabId && !current.titled) setTitle(stripSuffix(change.title));
});
void refresh();

async function refresh(): Promise<void> {
  // currentWindow is the window this panel belongs to.
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const videoId = videoIdFromUrl(tab?.url);
  if (current && current.videoId === videoId && current.tabId === tab?.id) return;

  current?.unwatch();
  current = undefined;
  if (!tab?.id || !videoId) {
    setTitle(DEFAULT_TITLE);
    renderMessage('Open a YouTube video to summarize it here.');
    return;
  }

  const tabId = tab.id;
  const self = { videoId, tabId, titled: false, unwatch: () => {} };
  current = self;
  setTitle(tab.title ? stripSuffix(tab.title) : DEFAULT_TITLE);

  const start = (force = false) =>
    sendToBackground({ type: 'getSummary', videoId, tabId, force }).catch((err: unknown) => {
      if (current === self) renderError(toUserError(err), () => start(true));
    });

  const render = (state: SummaryState | undefined) => {
    if (current !== self) return;
    if (!state || state.status === 'loading') renderLoading();
    else if (state.status === 'error') renderError(state.error, () => start(true));
    else {
      if (state.title) {
        self.titled = true;
        setTitle(state.title);
      }
      renderSummary(state.summary, state.usage, videoId, tabId, () => start(true));
    }
  };

  self.unwatch = watchSummaryState(videoId, render);
  render(await getSummaryState(videoId));
  if (current === self) await start();
}

function setTitle(title: string): void {
  titleEl.textContent = title;
  titleEl.title = title;
}

function stripSuffix(tabTitle: string): string {
  return tabTitle.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '');
}

/** Replaces the panel content, and stops highlighting for whatever summary was there. */
function show(...children: (Node | string)[]): void {
  stopTracking?.();
  stopTracking = undefined;
  content.replaceChildren(...children);
}

function renderLoading(): void {
  const skeleton = (...widths: string[]) =>
    el('div', { className: 'card' }, ...widths.map((w) => el('div', { className: `skeleton ${w}` })));
  show(
    el(
      'div',
      { className: 'loading' },
      el('div', { className: 'loading-label' }, el('span', { className: 'pulse' }), 'Reading the transcript and summarizing…'),
      skeleton('', 'mid', 'short'),
      skeleton('mid', '', 'short', 'mid'),
    ),
  );
}

function renderMessage(text: string): void {
  show(
    el('div', { className: 'status' }, el('div', { className: 'badge' }, icon('video')), el('p', {}, text)),
  );
}

function renderError(error: UserError, retry: () => void): void {
  const actions = el('div', { className: 'actions' });
  if (error.action === 'options') {
    actions.append(button('Open Options', () => browser.runtime.openOptionsPage(), '', icon('key')));
  }
  actions.append(button('Try again', retry, error.action === 'options' ? 'secondary' : '', icon('refresh')));
  show(
    el(
      'div',
      { className: 'status error' },
      el('div', { className: 'badge' }, icon('alert')),
      el('p', {}, error.message),
      actions,
    ),
  );
}

function renderSummary(
  summary: Summary,
  usage: SummaryUsage | undefined,
  videoId: string,
  tabId: number,
  resummarize: () => void,
): void {
  const rows: HTMLButtonElement[] = [];
  let currentRow = -1;
  const highlight = (index: number) => {
    if (index === currentRow) return;
    rows[currentRow]?.classList.remove('current');
    rows[currentRow]?.removeAttribute('aria-current');
    rows[index]?.classList.add('current');
    rows[index]?.setAttribute('aria-current', 'true');
    currentRow = index;
  };
  const track = async () => {
    if (document.hidden) return;
    // Fails while the tab reloads; the next tick tries again.
    const playback = await sendToTab(tabId, { type: 'getPlayback', videoId }).catch(() => null);
    if (playback) highlight(currentSectionIndex(summary.sections, playback.seconds));
  };

  const seek = (seconds: number) =>
    sendToTab(tabId, { type: 'seek', seconds }).then(track, (err: unknown) => renderError(toUserError(err), resummarize));

  show(
    el('section', { className: 'card tldr' }, el('h2', {}, icon('spark'), 'TL;DR'), el('p', {}, summary.tldr)),
    el(
      'section',
      { className: 'card' },
      el('h2', {}, icon('list'), 'Key points'),
      el('ul', { className: 'points' }, ...summary.key_points.map((p) => el('li', {}, p))),
    ),
    summary.sections.length > 0
      ? el(
          'section',
          { className: 'card sections-card' },
          el('h2', {}, icon('clock'), 'Sections'),
          el(
            'ol',
            { className: 'sections' },
            ...summary.sections.map((s) => {
              const row = el(
                'button',
                { className: 'section', type: 'button', title: `Jump to ${formatTimestamp(s.start_seconds)}` },
                el('span', { className: 'time' }, icon('play'), formatTimestamp(s.start_seconds)),
                el(
                  'span',
                  {},
                  el('span', { className: 'section-title' }, s.title),
                  el('span', { className: 'section-summary' }, s.summary),
                ),
              );
              row.addEventListener('click', () => seek(s.start_seconds));
              rows.push(row);
              return el('li', {}, row);
            }),
          ),
        )
      : '',
    el('div', { className: 'actions' }, button('Re-summarize', resummarize, 'secondary', icon('refresh'))),
    usage ? renderUsage(usage) : '',
  );

  if (rows.length === 0) return;
  void track();
  const timer = setInterval(() => void track(), PLAYBACK_POLL_MS);
  stopTracking = () => clearInterval(timer);
}

/** One muted line under the summary: approximate cost and tokens, exact counts on hover. */
function renderUsage(usage: SummaryUsage): HTMLElement {
  const tokens = `${formatTokens(usage.inputTokens)} in · ${formatTokens(usage.outputTokens)} out`;
  const text = usage.costUsd === null ? `${tokens} tokens` : `≈ ${formatCost(usage.costUsd)} · ${tokens} tokens`;
  const n = (v: number) => v.toLocaleString();
  return el('p', {
    className: 'usage',
    title: `${usage.model}: ${n(usage.inputTokens)} input, ${n(usage.outputTokens)} output tokens. Cost is estimated from list prices.`,
  }, text);
}

function button(label: string, onClick: () => void, className = '', leading?: Node): HTMLButtonElement {
  const b = el('button', { className, type: 'button' }, ...(leading ? [leading] : []), label);
  b.addEventListener('click', onClick);
  return b;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
