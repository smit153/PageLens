// The extension's src/config.ts mirrors the constants in this file so both
// sides agree on limits without sharing a build. See CLAUDE.md for why they
// aren't a shared package.

/**
 * Absolute ceiling on chunks per request, across all batches. Not a coverage
 * limit for any realistic page -- at typical block sizes this is several
 * hundred thousand characters -- just a guard against a pathological page
 * turning into an unbounded number of Jev calls.
 */
export const MAX_CHUNKS = 960;

/** Most batches we will fan out concurrently for one search. */
export const MAX_BATCHES = 8;

/**
 * How many top-scoring chunks the refine pass narrows to a single sentence.
 *
 * The "fine" half of a coarse-to-fine retrieval: pass one scores every chunk,
 * then pass two pays for sentence precision only on the handful that earned it.
 */
export const REFINE_TOP_N = 3;

/** Ordered lowest -> highest, per Jev's `score` question rubric contract. */
export const RELEVANCE_RUBRIC = [
  'not relevant',
  'somewhat relevant',
  'relevant',
  'highly relevant',
] as const;

// Token cost model, fitted to measurements against typesafe-ai/jev rather than
// guessed. Two real requests built from Wikipedia page content:
//
//     30 chunks / 10,681 chars -> 5,221 input tokens
//     89 chunks / 31,353 chars -> 15,074 input tokens
//
// Solving those gives a fixed base, a per-question cost (instructions plus the
// four rubric criteria, paid once per chunk regardless of chunk size), and a
// per-character cost for the chunk text carried in the shared state.
//
// The earlier estimate of chars/4 plus 40 tokens per question undercounted by
// roughly 30%, which is the dangerous direction: it guards the "too much text"
// fallback, so undercounting means sailing past the real limit into an API
// error instead of degrading gracefully.
const BASE_TOKENS = 180;
const TOKENS_PER_QUESTION = 79;
const TOKENS_PER_CHAR = 0.25;

export function estimateRequestTokens(query: string, chunks: Array<{ text: string }>): number {
  const chars = query.length + chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  return Math.ceil(BASE_TOKENS + chunks.length * TOKENS_PER_QUESTION + chars * TOKENS_PER_CHAR);
}

/**
 * Limits on a single batch, both set from what was measured to actually work
 * rather than from the documented ~32k context.
 *
 * Observed against typesafe-ai/jev:
 *   - 2 questions / ~0.3k tokens   -> fine
 *   - 89 questions / ~15.1k tokens -> fine, repeatedly
 *   - ~118 questions / ~20k tokens -> persistent 503s from the provider
 *
 * So the practical ceiling sits well below the nominal context window, on both
 * axes. A batch splits when it would exceed either. These are deliberately
 * conservative: an oversized batch does not degrade, it fails outright and
 * takes a slice of the page's coverage with it.
 */
export const BATCH_TOKEN_BUDGET = 12_000;
export const MAX_QUESTIONS_PER_BATCH = 80;

/**
 * Splits chunks into batches that each fit the per-call budget, so a page of
 * any size can be scored in full by fanning the batches out in parallel.
 *
 * Page position is preserved: chunks stay in document order and batches are
 * contiguous slices, so nothing is reordered or dropped.
 */
export function batchChunks<T extends { text: string }>(query: string, chunks: T[]): T[][] {
  const perChunkFloor = TOKENS_PER_QUESTION + TOKENS_PER_CHAR;
  const budget = Math.max(BATCH_TOKEN_BUDGET, BASE_TOKENS + perChunkFloor);

  const batches: T[][] = [];
  let current: T[] = [];
  let tokens = BASE_TOKENS + query.length * TOKENS_PER_CHAR;

  for (const chunk of chunks) {
    const cost = TOKENS_PER_QUESTION + chunk.text.length * TOKENS_PER_CHAR;
    const wouldExceed = tokens + cost > budget || current.length >= MAX_QUESTIONS_PER_BATCH;
    // A single oversized chunk still has to go somewhere, so only split once
    // the batch already holds something.
    if (current.length > 0 && wouldExceed) {
      batches.push(current);
      current = [];
      tokens = BASE_TOKENS + query.length * TOKENS_PER_CHAR;
    }
    current.push(chunk);
    tokens += cost;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}
