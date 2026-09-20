# Deployment

This covers deploying the proxy and shipping the extension in more detail than the README's
quick-start. Read `README.md` first if you haven't set up the project yet.

## Proxy: AI Gateway credentials

Whether you run locally or deploy, you need an AI Gateway API key:

1. Create one at `https://vercel.com/<your-team>/~/ai-gateway/api-keys`.
2. **Add a payment card to the Vercel account.** AI Gateway rejects every request with
   `403 customer_verification_required` until a card is on file — this applies even to the free
   credits. The error text is: _"AI Gateway requires a valid credit card on file to service
   requests."_
3. Put the key in `proxy/.env.local` (copy `proxy/.env.local.example`). For deployed use, also
   add `AI_GATEWAY_API_KEY` under **Project Settings -> Environment Variables**.

## Local development (no Vercel CLI needed)

```bash
pnpm dev:proxy   # http://localhost:3000/api/search
```

This runs `proxy/dev-server.ts`: Node's built-in HTTP server wrapping the exact same
`api/search.ts` handler, loaded via Node's native TypeScript support and `--env-file`. No Vercel
account, no project linking, no build step. `--watch` restarts it on file changes.

Test it directly:

```bash
curl -X POST http://localhost:3000/api/search \
  -H "content-type: application/json" \
  -d '{"query":"pricing","chunks":[{"id":"c0","text":"Our plans start at $9/month."}]}'
```

### Why not `vercel dev`?

`vercel dev` was the original plan, but in this monorepo it fights the tooling in three separate
ways, all verified here:

1. **`DEV_RECURSIVE_INVOCATION`** — Vercel auto-detects `package.json`'s `dev` script as the
   project's Development Command. When that script was `vercel dev`, it refused to recurse into
   itself.
2. **`STATIC_BUILD_NO_OUT_DIR`** — with a `build` script present and no framework detected,
   Vercel assumes a static site and fails looking for a `public/` output directory. (This is why
   `proxy/package.json` has no `build` script, and the root's `build` uses `--if-present`.)
3. **Wrong project root** — `vercel link` writes a repo-level `.vercel/repo.json` at the _git
   root_ mapping the project to `"directory": "."`, so `vercel dev` runs the repo root's
   `package.json` instead of `proxy/`'s. Root Directory is a Vercel **project setting** (dashboard:
   Settings -> Build and Deployment -> Root Directory); it cannot be set from `vercel.json`.

If you do want `vercel dev` working, the fix is to set that project's Root Directory to `proxy`
in the dashboard. For local iteration the Node dev server is simpler and has no account
dependency at all.

## Deploying

```bash
pnpm --filter pagelens-proxy deploy   # vercel deploy --prod
```

Run it from `proxy/` (the script already does). On first deploy, confirm the project's **Root
Directory** is `proxy` if the project is Git-connected — otherwise Vercel builds from the repo
root and won't find `api/search.ts`.

Note the resulting production URL (e.g. `https://pagelens-proxy.vercel.app`). The search endpoint
is `<that URL>/api/search`.

If you outgrow the default domain, add a custom domain under **Project Settings -> Domains** —
just remember to update `PROXY_SEARCH_URL` and `host_permissions` (below) to match.

### Rate limiting

The proxy meters every search against a sliding window in Upstash Redis, and **fails closed** — if
it can't reach Redis, it refuses the request rather than letting model spend go unmetered. So the
credentials below are required for any deployment.

Budgets are counted in **Jev calls, not HTTP requests**, because one request can cost up to nine
model calls (see `CLAUDE.md`):

| Tier    | Key                                           | Budget                |
| ------- | --------------------------------------------- | --------------------- |
| IP      | `x-forwarded-for`, set by Vercel              | 60 Jev calls / minute |
| Install | `x-pagelens-install`, minted by the extension | 30 Jev calls / minute |

Both must pass. The install tier is checked first, so one browser that has exhausted its own
budget can't drain the IP budget it shares with everyone else behind the same NAT.

1. Create a Redis database — Vercel dashboard **Storage -> Upstash**, or directly at
   `https://console.upstash.com`. The free tier (10k commands/day) is ample: a search costs two
   commands.
2. Copy its REST credentials into `proxy/.env.local` **and** the Vercel project's Environment
   Variables:

   ```
   UPSTASH_REDIS_REST_URL=https://<your-db>.upstash.io
   UPSTASH_REDIS_REST_TOKEN=<token>
   ```

3. To run locally without an Upstash database, set `RATE_LIMIT_DISABLED=1` in `proxy/.env.local`.
   This is an explicit opt-out so that missing credentials can never quietly become "no limiting";
   never set it in a deployed environment.

Tuning the numbers: `IP_CALLS_PER_MINUTE` and `INSTALL_CALLS_PER_MINUTE` in
`proxy/lib/rate-limit.ts`.

A limited client gets a `429` with a `Retry-After` header and a `retryAfter` field in the JSON
body; the extension turns that into a "try again in Ns" message in the popup rather than a generic
failure.

## Extension

### Point it at your proxy

Two files need your deployed proxy's origin:

- `extension/src/config.ts` — `PROXY_SEARCH_URL`
- `extension/public/manifest.json` — `host_permissions`

### Build

```bash
pnpm build:extension
```

Output goes to `extension/dist/`. See `extension/vite.config.ts` and `extension/vite.mv3.config.ts`
for why the popup, background, and content script are built as three separate Vite invocations.

### Load unpacked (development / personal use)

1. `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** -> select `extension/dist`

Chrome watches the folder's manifest version but not its file contents — after a rebuild, click
the extension's reload icon on `chrome://extensions` (and reload any page you're testing on).

### Publishing to the Chrome Web Store (future)

Not covered by v1's scope. At a minimum you'd need: a real icon set (the manifest currently
ships without one — Chrome uses a generic icon), a Chrome Web Store developer account, and a
privacy-practices disclosure covering what the extension sends to your proxy (page text +
search queries — no PII is deliberately collected, but page content itself may contain it
depending on the site).
