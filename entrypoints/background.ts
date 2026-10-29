import { browser } from 'wxt/browser';
import { MessageError, onMessages, sendToTab, toUserError } from '@/lib/messages';
import { getSettings, getSummaryState, samePrefs, setSummaryState } from '@/lib/storage';
import { summarize, testApiKey } from '@/lib/summarize';

export default defineBackground(() => {
  // Summaries running in this worker instance. If the worker was restarted
  // mid-summary, storage still says "loading" but nothing is running; the next
  // getSummary from the popup notices and starts over.
  const running = new Set<string>();

  onMessages({
    getSummary: async ({ videoId, tabId, force }) => {
      if (running.has(videoId)) return;
      const state = await getSummaryState(videoId);
      // Errors are retried on the next popup open, so fixing the cause (adding
      // a key, reloading the tab) is enough.
      // A summary made with other prefs (or before prefs existed) is stale.
      if (!force && state?.status === 'done' && state.prefs && samePrefs(state.prefs, await getSettings())) return;
      void run(videoId, tabId);
    },
    testKey: ({ apiKey, model }) => testApiKey(apiKey, model),
  });

  async function run(videoId: string, tabId: number): Promise<void> {
    running.add(videoId);
    await setSummaryState(videoId, { status: 'loading', updatedAt: Date.now() });
    await setBadge(tabId, '…');
    try {
      const { apiKey, model, ...prefs } = await getSettings();
      if (!apiKey) throw new MessageError({ message: 'Add your API key in Options.', action: 'options' });
      const transcript = await sendToTab(tabId, { type: 'getTranscript', videoId });
      const summary = await summarize({ apiKey, model, transcript, prefs });
      await setSummaryState(videoId, { status: 'done', title: transcript.title, summary, prefs, updatedAt: Date.now() });
    } catch (err) {
      await setSummaryState(videoId, { status: 'error', error: toUserError(err), updatedAt: Date.now() });
    } finally {
      running.delete(videoId);
      await setBadge(tabId, '');
    }
  }
});

async function setBadge(tabId: number, text: string): Promise<void> {
  try {
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#555' });
    await browser.action.setBadgeText({ tabId, text });
  } catch {
    // Tab was closed.
  }
}
