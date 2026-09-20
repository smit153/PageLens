// Two-tier rate limiting for the public search endpoint.
//
// The endpoint is unauthenticated and spends AI Gateway money on every call,
// so this is cost control, not authentication. See CLAUDE.md for why the
// counters are keyed the way they are.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Budgets are denominated in Jev calls, not HTTP requests.
 *
 * One request is not one unit of cost: `batchChunks()` turns a long page into
 * up to MAX_BATCHES concurrent Jev calls plus an optional refine pass, so a
 * request-counting limiter would charge a 960-chunk caller the same as a
 * 5-chunk one and undercharge the expensive path by ~9x.
 */
export const IP_CALLS_PER_MINUTE = 60;

/**
 * The per-install budget is deliberately stricter than the per-IP one: it
 * exists to stop a single browser monopolising a shared IP's budget, not to
 * raise anyone's ceiling.
 */
export const INSTALL_CALLS_PER_MINUTE = 30;

const WINDOW = '60 s' as const;

/**
 * Only a well-formed v4 UUID is accepted as an install id. The value lands in
 * a Redis key, so anything else -- an empty string, a novel-length header, a
 * key-namespace escape attempt -- is dropped rather than trusted.
 */
const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ClientIdentity {
  /** From the connection, via Vercel's `x-forwarded-for`. Not caller-settable. */
  ip: string;
  /** The extension's per-install UUID, or null when absent or malformed. */
  install: string | null;
}

export type LimitVerdict =
  { ok: true } | { ok: false; reason: 'over-limit' | 'unavailable'; retryAfter: number };

/**
 * Derives the keys a request is metered against.
 *
 * `ip` is the authoritative one: Vercel sets `x-forwarded-for` from the actual
 * connection, so a caller cannot forge it. `install` is caller-supplied and
 * therefore only ever used to apply an *additional*, stricter limit -- never to
 * widen one. That distinction is the whole design:
 *
 * A client-controlled value used as the sole key is not a limit at all, because
 * whoever controls it mints fresh buckets on demand. It is also why the
 * user-agent header is deliberately not part of the key: post-UA-reduction it
 * carries almost no entropy (thousands of unrelated users share one string),
 * and being caller-settable, including it would let one attacker multiply their
 * own budget by varying it.
 */
export function identify(request: Request): ClientIdentity {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';

  const install = request.headers.get('x-pagelens-install')?.trim() ?? '';

  return { ip, install: INSTALL_ID_PATTERN.test(install) ? install : null };
}

/**
 * Shared across requests in the same isolate, so a caller already known to be
 * over its limit is rejected without a Redis round trip. Must live at module
 * scope to outlive a single invocation.
 */
const ephemeralCache = new Map<string, number>();

interface Limiters {
  ip: Ratelimit;
  install: Ratelimit;
}

let limiters: Limiters | null = null;

function getLimiters(): Limiters {
  if (limiters) return limiters;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are not set.');
  }

  // Constructed explicitly rather than via Redis.fromEnv() so the failure above
  // is our own message, and so the Edge Runtime's minimal `process` shim is
  // only ever read through lib/env.d.ts's declaration.
  const redis = new Redis({ url, token });

  limiters = {
    ip: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(IP_CALLS_PER_MINUTE, WINDOW),
      prefix: 'pagelens:ip',
      ephemeralCache,
    }),
    install: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(INSTALL_CALLS_PER_MINUTE, WINDOW),
      prefix: 'pagelens:install',
      ephemeralCache,
    }),
  };

  return limiters;
}

/** Seconds until the window reopens, floored at 1 so a client never retries instantly. */
function secondsUntil(reset: number): number {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

/**
 * Meters `cost` Jev calls against this client, returning whether the search may
 * proceed.
 *
 * Both tiers have to pass, and the stricter per-install one is checked first:
 * that way a browser that has blown its own budget is rejected without also
 * draining the IP budget it shares with everyone else behind the same NAT.
 *
 * Fails **closed**. An unreachable Redis means requests cannot be metered, and
 * unmetered requests here are unmetered spend on someone else's card. Set
 * RATE_LIMIT_DISABLED=1 to skip the limiter entirely for local development --
 * an explicit, visible opt-out rather than a silent no-op when credentials
 * happen to be missing.
 */
export async function checkLimit(client: ClientIdentity, cost: number): Promise<LimitVerdict> {
  if (process.env.RATE_LIMIT_DISABLED === '1') return { ok: true };

  const rate = Math.max(1, Math.trunc(cost));

  try {
    const { ip, install } = getLimiters();

    if (client.install) {
      const result = await install.limit(client.install, { rate });
      await result.pending;
      if (!result.success) {
        return { ok: false, reason: 'over-limit', retryAfter: secondsUntil(result.reset) };
      }
    }

    const result = await ip.limit(client.ip, { rate });
    await result.pending;
    if (!result.success) {
      return { ok: false, reason: 'over-limit', retryAfter: secondsUntil(result.reset) };
    }

    return { ok: true };
  } catch (error) {
    console.error('Rate limiter unavailable; refusing the request:', error);
    return { ok: false, reason: 'unavailable', retryAfter: 30 };
  }
}
