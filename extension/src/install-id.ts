/**
 * A stable per-install identifier, so the proxy can meter one browser rather
 * than one IP address.
 *
 * This is a fairness key, not a credential. Anyone can unzip the extension and
 * read this code, so the proxy treats it as caller-supplied and uses it only to
 * apply a *stricter* limit on top of its IP ceiling -- never to grant a larger
 * budget. See proxy/lib/rate-limit.ts.
 *
 * `chrome.storage.local` rather than IndexedDB: both hold the same
 * honest-client-only guarantee, but extension storage is not subject to
 * Chrome's best-effort quota eviction, is reachable directly from the MV3
 * service worker, and needs no open/upgrade dance.
 */

const STORAGE_KEY = 'pagelens:install-id';

/**
 * Deduplicates concurrent callers within a service worker's lifetime. Two
 * searches racing on a cold worker would otherwise both find an empty store and
 * mint competing ids.
 */
let pending: Promise<string | null> | null = null;

async function load(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const existing = stored[STORAGE_KEY];
    if (typeof existing === 'string' && existing.length > 0) return existing;

    const minted = crypto.randomUUID();
    await chrome.storage.local.set({ [STORAGE_KEY]: minted });
    return minted;
  } catch {
    // Storage can be unavailable (a locked profile, a quota error). The search
    // still works -- the proxy falls back to its IP-only ceiling -- so this is
    // not worth failing a search over.
    return null;
  }
}

export function getInstallId(): Promise<string | null> {
  pending ??= load();
  return pending;
}
