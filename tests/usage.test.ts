import { describe, expect, it } from 'vitest';
import { formatCost, formatTokens, summarizeUsage } from '../lib/usage';

describe('summarizeUsage', () => {
  it('prices Haiku at the short-prompt rate', () => {
    const u = summarizeUsage('claude-haiku-5-5', { input_tokens: 20_000, output_tokens: 2_000 });
    expect(u).toMatchObject({ model: 'claude-haiku-5-5', inputTokens: 20_000, outputTokens: 2_000 });
    // 20K × $0.10/M + 2K × $0.50/M
    expect(u.costUsd).toBeCloseTo(0.003, 10);
  });

  it('bills a long Haiku prompt entirely at the long-prompt rate', () => {
    const u = summarizeUsage('claude-haiku-5-5', { input_tokens: 120_000, output_tokens: 4_000 });
    // 120K × $0.50/M + 4K × $2.50/M
    expect(u.costUsd).toBeCloseTo(0.07, 10);
  });

  it('prices Sonnet', () => {
    const u = summarizeUsage('claude-sonnet-5-5', { input_tokens: 10_000, output_tokens: 1_000 });
    expect(u.costUsd).toBeCloseTo(0.03, 10);
  });

  it('counts cache tokens as input, priced with cache multipliers', () => {
    const u = summarizeUsage('claude-sonnet-5-5', {
      input_tokens: 1_000,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000,
      cache_read_input_tokens: 10_000,
    });
    expect(u.inputTokens).toBe(12_000);
    // (1000 + 1250 + 1000) × $2/M
    expect(u.costUsd).toBeCloseTo(0.0065, 10);
  });

  it('has no cost for an unknown model', () => {
    const u = summarizeUsage('claude-unknown', { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: null });
    expect(u.costUsd).toBeNull();
    expect(u.inputTokens).toBe(1);
  });
});

describe('formatTokens', () => {
  it.each([
    [850, '850'],
    [1000, '1K'],
    [12_345, '12.3K'],
    [1_200_000, '1.2M'],
  ])('%d → %s', (n, s) => expect(formatTokens(n)).toBe(s));
});

describe('formatCost', () => {
  it.each([
    [1.234, '$1.23'],
    [0.012, '$0.01'],
    [0.0034, '$0.0034'],
    [0.003, '$0.003'],
    [0.00001, '<$0.0001'],
  ])('%d → %s', (n, s) => expect(formatCost(n)).toBe(s));
});
