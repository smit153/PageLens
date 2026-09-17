# Deployment

This covers deploying the proxy and shipping the extension in more detail than the README's
quick-start. Read `README.md` first if you haven't set up the project yet.

## Proxy (Vercel Edge Function)

### First-time setup

1. Install the Vercel CLI dependency (already in `proxy/package.json`) and log in:

   ```bash
   cd proxy
   npx vercel login
   ```

2. Link the `proxy/` folder to a Vercel project:

   ```bash
   npx vercel link
   ```

   Choose (or create) a project — e.g. `pagelens-proxy`. This writes `proxy/.vercel/` (gitignored
   — it's local project linkage, not something to commit).

3. Create an AI Gateway API key for your team at
   `https://vercel.com/<your-team>/~/ai-gateway/api-keys`, then set it in two places:

   - Locally: `cp proxy/.env.local.example proxy/.env.local` and fill in `AI_GATEWAY_API_KEY`.
   - On Vercel: **Project Settings -> Environment Variables**, add `AI_GATEWAY_API_KEY` for the
     Production (and Preview, if you use preview deployments) environment.

### Local development

```bash
pnpm dev:proxy   # vercel dev, serves api/search.ts on http://localhost:3000/api/search
```

Test it directly:

```bash
curl -X POST http://localhost:3000/api/search \
  -H "content-type: application/json" \
  -d '{"query":"pricing","chunks":[{"id":"c0","text":"Our plans start at $9/month."}]}'
```

### Deploying

```bash
pnpm --filter pagelens-proxy deploy   # vercel deploy --prod
```

Note the resulting production URL (e.g. `https://pagelens-proxy.vercel.app`). The search endpoint
is `<that URL>/api/search`.

If you outgrow the default domain, add a custom domain under **Project Settings -> Domains** —
just remember to update `PROXY_SEARCH_URL` and `host_permissions` (below) to match.

### Rate limiting (deliberately out of scope for v1)

The proxy has no rate limiting or auth (see `CLAUDE.md` for why). If you're deploying this
somewhere it'll get real traffic, add a limiter (e.g. Vercel KV or Upstash Redis with a
sliding-window check) before relying on it being protected.

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
