// LOCAL DEV: `pnpm dev:proxy` serves this on port 3000. Switch this (and
// host_permissions in public/manifest.json) to your deployed proxy's URL
// before shipping (see README.md "Deploying the proxy").
export const PROXY_SEARCH_URL = 'http://localhost:3000/api/search';

/** Hard cap on chunks sent per search; matches the proxy's own cap. */
export const MAX_CHUNKS = 40;
export const CHUNK_SIZE = 400;
export const CHUNK_OVERLAP = 40;
export const MIN_CHUNK_CHARS = 40;
export const TOP_N_RESULTS = 8;

/**
 * Drop results scoring below this. Jev returns an interpolated score over the
 * rubric in proxy/lib/jev.ts, indexed from zero:
 *
 *   0 = not relevant, 1 = somewhat, 2 = relevant, 3 = highly relevant
 *
 * Without a floor, every search returns TOP_N_RESULTS passages even when the
 * page has no answer at all -- the top 8 of a bad set still get listed. 1.5 is
 * the midpoint between "somewhat" and "relevant".
 */
export const MIN_RESULT_SCORE = 1.5;

/**
 * Mirrors proxy/lib/jev.ts's own budget check so the content script can fail
 * fast, before ever messaging the background worker. Kept manually in sync
 * rather than shared as a package -- see CLAUDE.md.
 */
export const MAX_STATE_TOKENS = 24_000;

const CHARS_PER_TOKEN = 4;
const PER_QUESTION_OVERHEAD_TOKENS = 40;

export function estimateRequestTokens(query: string, chunks: Array<{ text: string }>): number {
  const stateChars = query.length + chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const stateTokens = Math.ceil(stateChars / CHARS_PER_TOKEN);
  return stateTokens + chunks.length * PER_QUESTION_OVERHEAD_TOKENS;
}
