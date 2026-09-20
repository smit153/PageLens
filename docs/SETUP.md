# Setup

From a fresh clone to searching a page. If you only want to change code and already have the
proxy running, steps 1 and 5 are all you need.

For _why_ the pieces fit together this way, see [`ARCHITECTURE.md`](ARCHITECTURE.md). For the
deployment details this guide summarises, see [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Prerequisites

| You need         | Version        | Notes                                                                |
| ---------------- | -------------- | -------------------------------------------------------------------- |
| Node.js          | 22.18+ or 24.x | The proxy dev server runs TypeScript directly; tested on 24.18       |
| pnpm             | 11.x           | `corepack enable` picks up the pinned version from `package.json`    |
| Chrome           | any MV3 build  | Or another Chromium browser with `chrome://extensions`               |
| A Vercel account | free tier      | For the AI Gateway key; a card must be on file even for free credits |

The Node floor is not arbitrary: `proxy/dev-server.ts` uses native TypeScript execution and
`node:module`'s `registerHooks`, both of which need 22.18 or newer.

## 1. Clone and install

```bash
git clone https://github.com/smit153/PageLens.git
cd PageLens
pnpm install
```

One install at the root covers both workspace packages. There is no build step for the proxy —
that is deliberate, and `DEPLOYMENT.md` explains why adding one breaks the Vercel deploy.

## 2. Get an AI Gateway key

The proxy calls Jev through Vercel's AI Gateway, and that key is the one thing that must never
reach the extension bundle.

1. Open `https://vercel.com/<your-team>/~/ai-gateway/api-keys` and create a key.
2. **Add a payment card to the Vercel account.** The Gateway rejects every request with
   `403 customer_verification_required` until one is on file — this applies even to the free
   credits.
3. Set a **spend cap** while you are there. The proxy has no rate limiting, so a cap is the only
   ceiling on what a runaway — or anyone who finds your deployed URL — can cost you.

## 3. Fill in the environment file

```bash
cp proxy/.env.local.example proxy/.env.local
```

Then edit `proxy/.env.local`:

```bash
AI_GATEWAY_API_KEY=<your key from step 2>
```

This file is gitignored. Never commit it.

## 4. Run the proxy locally

```bash
pnpm dev:proxy   # http://localhost:3000/api/search
```

This runs `proxy/dev-server.ts`: the same `api/search.ts` handler on Node's built-in HTTP server,
with no Vercel account, project linking or build step. (`vercel dev` fails three separate ways in
this monorepo — all documented in `DEPLOYMENT.md`.)

Check it end to end:

```bash
curl -s -X POST http://localhost:3000/api/search \
  -H "content-type: application/json" \
  -d '{"query":"what does it cost","chunks":[
        {"id":"c0","text":"Our plans start at $9 per month, billed annually."},
        {"id":"c1","text":"The office dog is called Biscuit."}]}'
```

You should get a 3 for `c0` and a 0 for `c1`:

```json
{
  "ok": true,
  "scores": [
    { "id": "c0", "score": 3 },
    { "id": "c1", "score": 0 }
  ],
  "coverage": { "scored": 2, "total": 2 }
}
```

A `200` here means the Gateway key works and the whole extract-score path is wired up.

## 5. Build and load the extension

```bash
pnpm build:extension
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select `extension/dist`

Open any article, press **Ctrl+Shift+F** (**Cmd+Shift+F** on macOS) and search.

By default the extension points at the deployed proxy. To use your local one, change **both**
of these to agree — the fetch is blocked if they disagree:

- `extension/src/config.ts` → `PROXY_SEARCH_URL = 'http://localhost:3000/api/search'`
- `extension/public/manifest.json` → `"host_permissions": ["http://localhost:3000/*"]`

Then rebuild. For iterative work, `pnpm dev:extension` runs the three builds in watch mode; Chrome
does not notice file changes, so click the extension's reload icon after each rebuild, and reload
the page you are testing on.

## 6. Deploy the proxy

```bash
pnpm --filter pagelens-proxy deploy   # vercel deploy --prod
```

Or connect the repo at [vercel.com/new](https://vercel.com/new) and set **Root Directory** to
`proxy`. The Git-connected route builds with the committed lockfile, so you get the dependency
versions you tested against.

**Set `AI_GATEWAY_API_KEY`** in the project's **Settings → Environment Variables** before or
immediately after the first deploy — `.env.local` covers local development only.

Then point the extension at the deployed URL, the same two files as in step 5, and rebuild.

## Verifying a deployment

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<your-proxy>/api/search \
  -H "content-type: application/json" \
  -d '{"query":"pricing","chunks":[{"id":"c0","text":"Plans start at $9/month."}]}'
```

`200` means the Gateway key is set and the function is serving.

## Troubleshooting

| Symptom                                               | Cause                                                    | Fix                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `500` — "Proxy is misconfigured"                      | `AI_GATEWAY_API_KEY` not set                             | Add it to `.env.local`, or to the Vercel project for a deployment       |
| `403 customer_verification_required`                  | No card on the Vercel account                            | Add one; this applies even to free credits                              |
| `502` — "The relevance model call failed"             | Every Jev batch failed upstream                          | Usually transient; retry. Persistent means the Gateway is rejecting you |
| Build: `referencing unsupported modules: ../lib/*.ts` | An import used a literal `.ts` extension                 | Use `.js` specifiers pointing at the `.ts` source — see `CLAUDE.md`     |
| Popup: "Could not reach the search proxy"             | `PROXY_SEARCH_URL` and `host_permissions` disagree       | Make both match, rebuild, reload the extension                          |
| Popup: "No readable text was found"                   | The page is a PDF viewer, canvas app, or otherwise empty | Expected; PageLens reads the DOM only                                   |
| Extension changes do not appear                       | Chrome caches the loaded build                           | Reload at `chrome://extensions`, then reload the page                   |

## Checks before a pull request

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Commit messages are linted by a husky `commit-msg` hook, so a non-conventional message is rejected
locally. See [`../CONTRIBUTING.md`](../CONTRIBUTING.md).
