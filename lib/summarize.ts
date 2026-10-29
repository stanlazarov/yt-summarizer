import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Transcript } from './messages';
import { MessageError } from './messages';
import type { ModelId, UserError } from './storage';
import { formatTranscript, mergeSegments } from './transcript';

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

const SYSTEM_PROMPT = `You summarize YouTube videos from their transcripts. Each transcript line starts with a [m:ss] or [h:mm:ss] timestamp.

Produce:
- tldr: two to four sentences covering what the video is about and its main conclusion.
- key_points: 3 to 8 short bullets with the most important takeaways, specific rather than generic.
- sections: a chapter-style breakdown in chronological order. Each section's start_seconds must be taken from a timestamp that appears in the transcript, converted to seconds. Give each a short title and a one or two sentence summary. Aim for one section per distinct topic; a 10-minute video usually has 3 to 6, an hour-long one 8 to 15.

Summarize only what the transcript says. Don't add outside facts or opinions. Transcripts are often auto-generated, so silently correct obvious transcription errors in names and terms. Write the summary in the same language as the transcript.`;

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
}): Promise<Summary> {
  const { transcript } = opts;
  const text = formatTranscript(mergeSegments(transcript.segments));
  const withFallback = FALLBACK_MODELS.has(opts.model);

  let response;
  try {
    response = await client(opts.apiKey).beta.messages.parse({
      model: opts.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
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
  return postProcess(response.parsed_output, transcript.durationSec);
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
