import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../lib/storage';
import { buildSystemPrompt, mapApiError, postProcess } from '../lib/summarize';
import { formatTimestamp, parseTimestamp } from '../lib/time';

describe('postProcess', () => {
  const summary = {
    tldr: 't',
    key_points: ['k'],
    sections: [
      { start_seconds: 120.4, title: 'b', summary: '' },
      { start_seconds: 0, title: 'a', summary: '' },
      { start_seconds: 9999, title: 'past the end', summary: '' },
      { start_seconds: -5, title: 'negative', summary: '' },
    ],
  };

  it('drops out-of-range sections, rounds, and sorts', () => {
    expect(postProcess(summary, 600).sections.map((s) => [s.title, s.start_seconds])).toEqual([
      ['a', 0],
      ['b', 120],
    ]);
  });

  it('keeps everything non-negative when the duration is unknown', () => {
    expect(postProcess(summary, 0).sections.map((s) => s.title)).toEqual(['a', 'b', 'past the end']);
  });
});

describe('buildSystemPrompt', () => {
  it('defaults to the transcript language', () => {
    expect(buildSystemPrompt(DEFAULT_PREFS)).toContain('same language as the transcript');
  });

  it('uses the chosen language', () => {
    const prompt = buildSystemPrompt({ ...DEFAULT_PREFS, language: 'German' });
    expect(prompt).toContain('in German');
    expect(prompt).not.toContain('same language as the transcript');
  });

  it('differs by length and style', () => {
    const prompts = new Set(
      (['brief', 'standard', 'detailed'] as const).flatMap((length) =>
        (['notes', 'bullets', 'eli5'] as const).map((style) => buildSystemPrompt({ ...DEFAULT_PREFS, length, style })),
      ),
    );
    expect(prompts.size).toBe(9);
  });

  it('always keeps the timestamp rule', () => {
    expect(buildSystemPrompt({ language: 'auto', length: 'detailed', style: 'eli5' })).toContain(
      'start_seconds must be taken from a timestamp',
    );
  });
});

describe('mapApiError', () => {
  const headers = new Headers();
  it.each([
    [401, 'Invalid API key, check Options.', 'options'],
    [429, 'Rate limited, try again in a moment.', undefined],
    [500, "Couldn't reach Claude, try again.", undefined],
    [529, 'Claude is overloaded right now, try again in a moment.', undefined],
  ])('maps %i', (status, message, action) => {
    const err = Anthropic.APIError.generate(status, { error: { message: 'raw' } }, 'raw', headers);
    expect(mapApiError(err)).toEqual(action ? { message, action } : { message });
  });

  it('maps network errors', () => {
    expect(mapApiError(new Anthropic.APIConnectionError({ message: 'offline' })).message).toBe(
      "Couldn't reach Claude, try again.",
    );
  });
});

describe('time', () => {
  it.each([
    [0, '0:00'],
    [75, '1:15'],
    [3725, '1:02:05'],
    [59.9, '0:59'],
  ])('formats %d as %s', (s, text) => expect(formatTimestamp(s)).toBe(text));

  it.each([
    ['1:15', 75],
    ['1:02:05', 3725],
    [' 0:07 ', 7],
    ['abc', null],
    ['', null],
  ])('parses %s', (text, s) => expect(parseTimestamp(text)).toBe(s));
});
