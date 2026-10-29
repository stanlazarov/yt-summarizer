// Token usage and approximate cost of a summary, from the API response's
// `usage` field. Pure, so it can be tested.

/** Tokens a summary used and what they cost, as stored with the summary. */
export interface SummaryUsage {
  /** The model that served the request (can differ from the chosen one after a fallback). */
  model: string;
  /** All prompt tokens, including any read from or written to the cache. */
  inputTokens: number;
  /** Includes thinking tokens, which are billed as output. */
  outputTokens: number;
  /** `null` when the serving model has no known price. */
  costUsd: number | null;
}

/** The subset of the API's usage object this needs. */
export interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

interface Rate {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

/**
 * First-party API list prices (USD per million tokens) as of 2026-10. Long
 * prompts can cost more: past `longAbove` prompt tokens the whole request is
 * billed at `long` rates.
 */
const PRICES: Record<string, Rate & { long?: Rate; longAbove?: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, long: { input: 0.5, output: 2.5 }, longAbove: 100_000 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

/** Cache writes cost more than plain input and cache reads much less. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export function summarizeUsage(model: string, usage: ApiUsage): SummaryUsage {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const inputTokens = usage.input_tokens + cacheWrite + cacheRead;
  const outputTokens = usage.output_tokens;

  const price = PRICES[model];
  let costUsd: number | null = null;
  if (price) {
    const rate = price.long && price.longAbove !== undefined && inputTokens > price.longAbove ? price.long : price;
    const billedInput = usage.input_tokens + cacheWrite * CACHE_WRITE_MULTIPLIER + cacheRead * CACHE_READ_MULTIPLIER;
    costUsd = (billedInput * rate.input + outputTokens * rate.output) / 1_000_000;
  }
  return { model, inputTokens, outputTokens, costUsd };
}

/** "850", "12.3K", "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Cents for larger amounts, two significant digits for fractions of a cent: "$0.12", "$0.0034". */
export function formatCost(usd: number): string {
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd < 0.0001) return '<$0.0001';
  return `$${Number(usd.toPrecision(2))}`;
}
