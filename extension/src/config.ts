// EDIT AFTER DEPLOYING THE PROXY: point this at your deployed Edge Function,
// and update host_permissions in public/manifest.json to match the same
// origin (see README.md "Deploying the proxy").
export const PROXY_SEARCH_URL = 'https://your-proxy.vercel.app/api/search';

/** Hard cap on chunks sent per search; matches the proxy's own cap. */
export const MAX_CHUNKS = 40;
export const CHUNK_SIZE = 400;
export const CHUNK_OVERLAP = 40;
export const MIN_CHUNK_CHARS = 40;
export const TOP_N_RESULTS = 8;

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
