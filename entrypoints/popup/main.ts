// Stateless: everything comes from chrome.storage.session, so closing and
// reopening the popup mid-summary picks up where the background is.

import { browser } from 'wxt/browser';
import { sendToBackground, sendToTab, toUserError } from '@/lib/messages';
import { getSummaryState, watchSummaryState, type SummaryState, type UserError } from '@/lib/storage';
import type { Summary } from '@/lib/summarize';
import { formatTimestamp } from '@/lib/time';
import { videoIdFromUrl } from '@/lib/transcript';

const content = document.getElementById('content')!;
const titleEl = document.getElementById('title')!;
document.getElementById('options')!.addEventListener('click', () => browser.runtime.openOptionsPage());

void init();

async function init(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const videoId = videoIdFromUrl(tab?.url);
  if (!tab?.id || !videoId) {
    renderMessage('Open a YouTube video, then click the extension icon to summarize it.');
    return;
  }
  const tabId = tab.id;

  const start = (force = false) =>
    sendToBackground({ type: 'getSummary', videoId, tabId, force }).catch((err: unknown) =>
      renderError(toUserError(err), () => start(true)),
    );

  const render = (state: SummaryState | undefined) => {
    if (!state || state.status === 'loading') renderLoading();
    else if (state.status === 'error') renderError(state.error, () => start(true));
    else renderSummary(state.title, state.summary, tabId, () => start(true));
  };

  watchSummaryState(videoId, render);
  render(await getSummaryState(videoId));
  await start();
}

function renderLoading(): void {
  content.replaceChildren(
    el('div', { className: 'status' }, el('div', { className: 'spinner' }), el('p', {}, 'Summarizing…')),
  );
}

function renderMessage(text: string): void {
  content.replaceChildren(el('p', { className: 'status' }, text));
}

function renderError(error: UserError, retry: () => void): void {
  const actions = el('div', { className: 'actions' });
  if (error.action === 'options') {
    actions.append(button('Open Options', () => browser.runtime.openOptionsPage()));
  }
  actions.append(button('Try again', retry, error.action === 'options' ? 'secondary' : ''));
  content.replaceChildren(el('div', { className: 'status error' }, el('p', {}, error.message), actions));
}

function renderSummary(title: string, summary: Summary, tabId: number, resummarize: () => void): void {
  if (title) titleEl.textContent = title;

  const seek = (seconds: number) =>
    sendToTab(tabId, { type: 'seek', seconds }).catch((err: unknown) => renderError(toUserError(err), resummarize));

  content.replaceChildren(
    el('section', {}, el('h2', {}, 'TL;DR'), el('p', {}, summary.tldr)),
    el(
      'section',
      {},
      el('h2', {}, 'Key points'),
      el('ul', {}, ...summary.key_points.map((p) => el('li', {}, p))),
    ),
    summary.sections.length > 0
      ? el(
          'section',
          {},
          el('h2', {}, 'Sections'),
          el(
            'ol',
            { className: 'sections' },
            ...summary.sections.map((s) =>
              el(
                'li',
                {},
                button(formatTimestamp(s.start_seconds), () => seek(s.start_seconds), 'timestamp'),
                el('div', {}, el('strong', {}, s.title), el('p', {}, s.summary)),
              ),
            ),
          ),
        )
      : '',
    el('div', { className: 'actions' }, button('Re-summarize', resummarize, 'secondary')),
  );
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el('button', { className, type: 'button' }, label);
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
