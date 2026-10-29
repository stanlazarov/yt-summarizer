import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'YouTube Summarizer',
    description: 'Summarize the YouTube video in the current tab with Claude.',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['*://www.youtube.com/*', 'https://api.anthropic.com/*'],
    action: { default_title: 'Summarize this video' },
  },
});
