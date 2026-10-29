import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Transcript } from './messages';
import { MessageError } from './messages';
import type { ModelId, SummaryLength, SummaryPrefs, SummaryStyle, UserError } from './storage';
import { formatTranscript, mergeSegments } from './transcript';
import { summarizeUsage, type SummaryUsage } from './usage';

export const Summary = z.object({
  tldr: z.string(),
  key_points: z.array(z.string()),
  sections: z.array(
    z.object({
      start_seconds: z.number(),
      title: z.string(),
      summary: z.string(),
    }),
  ),
});
export type Summary = z.infer<typeof Summary>;

const LENGTH_RULES: Record<SummaryLength, string> = {
  brief: `- tldr: one or two sentences covering what the video is about and its main conclusion.
- key_points: 3 to 5 of the most important takeaways.
- sections: one per major topic only; a 10-minute video usually has 2 to 4, an hour-long one 5 to 8. Each section summary is one sentence.`,
  standard: `- tldr: two to four sentences covering what the video is about and its main conclusion.
- key_points: 3 to 8 short bullets with the most important takeaways.
- sections: one per distinct topic; a 10-minute video usually has 3 to 6, an hour-long one 8 to 15. Each section summary is one or two sentences.`,
  detailed: `- tldr: a short paragraph (three to five sentences) covering what the video is about, how it gets there, and its main conclusion.
- key_points: 6 to 12 takeaways, including supporting details, numbers, examples, and caveats the video gives.
- sections: one per distinct topic; a 10-minute video usually has 4 to 7, an hour-long one 10 to 18. Each section summary is two to four sentences.`,
};

const STYLE_RULES: Record<SummaryStyle, string> = {
  notes: `Write like concise study notes: full but compact sentences, specific rather than generic, keeping the video's terminology.`,
  bullets: `Write as terse as possible: key points and section summaries are short fragments (no full sentences needed, no filler words), and each key point is one idea of at most about 12 words. The tldr may be full sentences.`,
  eli5: `Explain like you're talking to a curious 10-year-old: plain everyday words, short sentences, and a quick analogy where it helps. Explain any jargon you can't avoid. Stay accurate; simplify, don't distort.`,
};

/** Builds the system prompt for the user's summary prefs. Pure, so it can be tested. */
export function buildSystemPrompt(prefs: SummaryPrefs): string {
  const language =
    prefs.language === 'auto'
      ? 'Write the summary in the same language as the transcript.'
      : `Write the whole summary (tldr, key points, section titles and summaries) in ${prefs.language}, whatever language the transcript is in. Keep names and established technical terms in their usual form.`;
  return `You summarize YouTube videos from their transcripts. Each transcript line starts with a [m:ss] or [h:mm:ss] timestamp.

Produce:
${LENGTH_RULES[prefs.length]}
- Sections are a chapter-style breakdown in chronological order. Each section's start_seconds must be taken from a timestamp that appears in the transcript, converted to seconds. Give each a short title.

Style: ${STYLE_RULES[prefs.style]}

Summarize only what the transcript says. Don't add outside facts or opinions. Transcripts are often auto-generated, so silently correct obvious transcription errors in names and terms. ${language}`;
}

/** Server-side fallbacks exist only for Sonnet; Haiku has none. */
const FALLBACK_MODELS: ReadonlySet<ModelId> = new Set(['claude-sonnet-5-5']);

function client(apiKey: string): Anthropic {
  // The key belongs to the user and never leaves their browser except to the API.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export async function summarize(opts: {
  apiKey: string;
  model: ModelId;
  transcript: Transcript;
  prefs: SummaryPrefs;
}): Promise<{ summary: Summary; usage: SummaryUsage }> {
  const { transcript } = opts;
  const text = formatTranscript(mergeSegments(transcript.segments));
  const withFallback = FALLBACK_MODELS.has(opts.model);

  let response;
  try {
    response = await client(opts.apiKey).beta.messages.parse({
      model: opts.model,
      max_tokens: 16000,
      system: buildSystemPrompt(opts.prefs),
      messages: [
        {
          role: 'user',
          content: `Video title: ${transcript.title || '(unknown)'}\n\n<transcript>\n${text}\n</transcript>`,
        },
      ],
      output_config: { format: betaZodOutputFormat(Summary), effort: 'medium' },
      ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
  } catch (err) {
    throw new MessageError(mapApiError(err));
  }

  if (response.stop_reason === 'refusal') {
    throw new MessageError({
      message: withFallback
        ? "Couldn't summarize this video."
        : "Couldn't summarize this video. Try Sonnet in Options.",
      action: withFallback ? undefined : 'options',
    });
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new MessageError({ message: 'Summary was incomplete, try again.' });
  }
  return {
    summary: postProcess(response.parsed_output, transcript.durationSec),
    // After a fallback, `model` is the one that served the request.
    usage: summarizeUsage(response.model, response.usage),
  };
}

/** Drops sections outside the video and sorts them by start time. */
export function postProcess(summary: Summary, durationSec: number): Summary {
  const sections = summary.sections
    .map((s) => ({ ...s, start_seconds: Math.round(s.start_seconds) }))
    .filter((s) => s.start_seconds >= 0 && (durationSec <= 0 || s.start_seconds <= durationSec))
    .sort((a, b) => a.start_seconds - b.start_seconds);
  return { ...summary, sections };
}

/** Checks a key with a free Models API call. */
export async function testApiKey(apiKey: string, model: ModelId): Promise<void> {
  try {
    await client(apiKey).models.retrieve(model);
  } catch (err) {
    throw new MessageError(mapApiError(err));
  }
}

export function mapApiError(err: unknown): UserError {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { message: 'Invalid API key, check Options.', action: 'options' };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { message: 'Rate limited, try again in a moment.' };
  }
  if (err instanceof Anthropic.InternalServerError && err.status === 529) {
    return { message: 'Claude is overloaded right now, try again in a moment.' };
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
    return { message: "Couldn't reach Claude, try again." };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { message: 'This model isn\'t available for your API key. Pick another in Options.', action: 'options' };
  }
  console.error(err);
  return { message: 'Claude returned an error, try again.' };
}
