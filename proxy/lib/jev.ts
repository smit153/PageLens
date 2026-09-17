// The extension's src/config.ts mirrors the constants in this file so both
// sides agree on limits without sharing a build. See CLAUDE.md for why they
// aren't a shared package.

/** Hard cap on chunks accepted per request; matches the extension's own cap. */
export const MAX_CHUNKS = 50;

/** Ordered lowest -> highest, per Jev's `score` question rubric contract. */
export const RELEVANCE_RUBRIC = [
  'not relevant',
  'somewhat relevant',
  'relevant',
  'highly relevant',
] as const;

/**
 * Jev's context budget is ~32k tokens for state + questions combined. Stay
 * well under that so per-chunk rubric/instruction overhead never tips a
 * request over the real limit.
 */
export const MAX_STATE_TOKENS = 24_000;

const CHARS_PER_TOKEN = 4;
const PER_QUESTION_OVERHEAD_TOKENS = 40;

export function estimateRequestTokens(query: string, chunks: Array<{ text: string }>): number {
  const stateChars = query.length + chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const stateTokens = Math.ceil(stateChars / CHARS_PER_TOKEN);
  return stateTokens + chunks.length * PER_QUESTION_OVERHEAD_TOKENS;
}
