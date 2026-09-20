// LOCAL DEV: `pnpm dev:proxy` serves this on port 3000. To use the deployed
// proxy instead, switch this to `https://<your-proxy>.vercel.app/api/search`
// and change host_permissions in public/manifest.json to match -- both have to
// agree, or the fetch is blocked. See docs/SETUP.md.
export const PROXY_SEARCH_URL = 'http://localhost:3000/api/search';

/**
 * Absolute ceiling on chunks sent per search, matching the proxy's own cap.
 *
 * This is a guard against a pathological page, not a coverage limit: the proxy
 * splits whatever it receives into batches that each fit Jev's context and
 * scores them in parallel, so a normal page is now covered in full. It used to
 * be 40, which silently discarded about three blocks in five and made words
 * that were plainly on the page unfindable.
 */
export const MAX_CHUNKS = 960;
export const CHUNK_SIZE = 400;
export const CHUNK_OVERLAP = 40;
export const MIN_CHUNK_CHARS = 40;

/** Highest score Jev can return, i.e. the top rung of the rubric in
 *  proxy/lib/jev.ts. Used to render a score as a percentage. */
export const MAX_SCORE = 3;

/**
 * Ceiling on total page text sent for one search, in characters. The proxy
 * batches whatever it gets, so this only bounds how much of an enormous page
 * we are willing to pay to score, and how large a message we push through
 * chrome.runtime. Roughly 330k characters, well beyond any normal article.
 *
 * The old token-estimate guard lived here and mirrored proxy/lib/jev.ts. That
 * estimate was measured to undercount by ~30%, and batching made a
 * whole-request budget meaningless anyway, so the check now lives in one place:
 * the proxy, which owns the Jev contract.
 */
export const MAX_PAGE_CHARS = 330_000;
