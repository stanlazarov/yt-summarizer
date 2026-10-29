// Stateless: everything comes from chrome.storage.session, so closing and
// reopening the popup mid-summary picks up where the background is.

import { browser } from 'wxt/browser';
import { sendToBackground, sendToTab, toUserError } from '@/lib/messages';
import {
  getPopupSize,
  getSummaryState,
  POPUP_SIZES,
  setPopupSize,
  watchSummaryState,
  type PopupSize,
  type SummaryState,
  type UserError,
} from '@/lib/storage';
import type { Summary } from '@/lib/summarize';
import { formatTimestamp } from '@/lib/time';
import { videoIdFromUrl } from '@/lib/transcript';
import { icon } from './icons';

const content = document.getElementById('content')!;
const titleEl = document.getElementById('title')!;
document.getElementById('brand')!.append(icon('logo'));
document.getElementById('options')!.append(icon('settings'));
document.getElementById('options')!.addEventListener('click', () => browser.runtime.openOptionsPage());

const sizeButton = document.getElementById('size')!;
sizeButton.append(icon('resize'));
let size: PopupSize = POPUP_SIZES[1];
sizeButton.addEventListener('click', () => {
  // Cycle through presets; Chrome popups can't be drag-resized.
  size = POPUP_SIZES[(POPUP_SIZES.indexOf(size) + 1) % POPUP_SIZES.length]!;
  applySize(size);
  void setPopupSize(size.id);
});
void getPopupSize().then((s) => {
  size = s;
  applySize(s);
});

function applySize(s: PopupSize): void {
  document.documentElement.style.setProperty('--popup-width', `${s.width}px`);
  document.documentElement.style.setProperty('--popup-height', `${s.height}px`);
  sizeButton.title = `Popup size: ${s.label} (click to change)`;
}

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
  const skeleton = (...widths: string[]) =>
    el('div', { className: 'card' }, ...widths.map((w) => el('div', { className: `skeleton ${w}` })));
  content.replaceChildren(
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
  content.replaceChildren(
    el('div', { className: 'status' }, el('div', { className: 'badge' }, icon('video')), el('p', {}, text)),
  );
}

function renderError(error: UserError, retry: () => void): void {
  const actions = el('div', { className: 'actions' });
  if (error.action === 'options') {
    actions.append(button('Open Options', () => browser.runtime.openOptionsPage(), '', icon('key')));
  }
  actions.append(button('Try again', retry, error.action === 'options' ? 'secondary' : '', icon('refresh')));
  content.replaceChildren(
    el(
      'div',
      { className: 'status error' },
      el('div', { className: 'badge' }, icon('alert')),
      el('p', {}, error.message),
      actions,
    ),
  );
}

function renderSummary(title: string, summary: Summary, tabId: number, resummarize: () => void): void {
  if (title) {
    titleEl.textContent = title;
    titleEl.title = title;
  }

  const seek = (seconds: number) =>
    sendToTab(tabId, { type: 'seek', seconds }).catch((err: unknown) => renderError(toUserError(err), resummarize));

  content.replaceChildren(
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
              return el('li', {}, row);
            }),
          ),
        )
      : '',
    el('div', { className: 'actions' }, button('Re-summarize', resummarize, 'secondary', icon('refresh'))),
  );
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
