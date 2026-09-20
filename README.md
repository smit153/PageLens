# PageLens

An in-page semantic search Chrome extension. Type a query in the popup and PageLens finds the
most relevant passages on the current tab, scored by [TypeSafe AI's Jev
model](https://typesafe.ai/) (a typed decision model — it returns scores against a rubric, not
generated text) via the Vercel AI SDK's `experimental_evaluate()`.

## How it works

1. **Content script** walks the visible DOM (paragraphs, list items, headings — skipping
   nav/footer/script/style and citation containers), and uses LangChain's
   `RecursiveCharacterTextSplitter` to break long blocks into passages.
2. **Popup** sends the query to the **background service worker**.
3. **Background worker** injects the content script (via `activeTab` + `scripting`, granted when
   you open the popup — no broad host permissions needed), collects the chunks, and POSTs
   `{ query, chunks }` to the **proxy**.
4. **Proxy** (a Vercel Edge Function) splits the chunks into batches that each fit a Jev call and
   scores them **in parallel**, so the whole page is covered rather than a sample of it. Each batch
   is one `evaluate()` call with one `score` question per chunk, rubric
   `not relevant / somewhat relevant / relevant / highly relevant`. For phrase and question
   searches, a second pass then picks the single sentence that answers the query.
5. **Background worker** ranks by score, applies the shape-dependent floor, and labels each result
   exact or semantic.
6. **Content script** marks every result in the page — literal terms in amber, answer sentences in
   purple — and auto-scrolls to the best one. The popup lists the results with a match-kind pill;
   clicking one scrolls the page to that passage.

The extension never talks to Jev or the AI Gateway directly — it only ever calls your proxy, so
no credentials ship in the extension bundle.

## Project layout

```
extension/   Chrome extension (Manifest V3, TypeScript, Vite)
proxy/       Vercel Edge Function proxy (TypeScript, `ai` SDK)
```

This is a single pnpm workspace — one `pnpm install` at the repo root installs both packages.

## Setup

```bash
pnpm install
```

### 1. Deploy the proxy

```bash
cd proxy
cp .env.local.example .env.local
# edit .env.local and set AI_GATEWAY_API_KEY
```

Get a key from your Vercel team's **AI Gateway → API Keys** page (requires a Vercel account, and
a card on file — AI Gateway returns a 403 `customer_verification_required` until you add one,
even to spend the free credits).

The proxy is rate limited and **fails closed**, so it also needs an Upstash Redis database — create
one from the Vercel dashboard's **Storage → Upstash** or at
[console.upstash.com](https://console.upstash.com), then set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` in the same `.env.local`. The free tier is ample; a search costs two
commands. To run locally without one, set `RATE_LIMIT_DISABLED=1` instead.

For local development:

```bash
pnpm dev:proxy   # http://localhost:3000/api/search
```

That runs `proxy/dev-server.ts` — the same `api/search.ts` handler on Node's built-in HTTP
server. It needs no Vercel account, project linking, or `vercel dev`. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for why we don't use `vercel dev` locally.

To deploy:

```bash
pnpm --filter pagelens-proxy deploy   # runs `vercel deploy --prod`
```

On first deploy, also set `AI_GATEWAY_API_KEY`, `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` in the Vercel project's **Settings → Environment Variables** (the
`.env.local` file only covers local development). Without the Upstash pair the limiter fails
closed and every search returns a 503.

Vercel will give you a production URL like `https://pagelens-proxy.vercel.app`. Note the full
search endpoint: `https://pagelens-proxy.vercel.app/api/search`.

### 2. Point the extension at your proxy

Edit two files with your deployed proxy's origin:

- `extension/src/config.ts` — set `PROXY_SEARCH_URL` to `https://<your-proxy>.vercel.app/api/search`
- `extension/public/manifest.json` — set `host_permissions` to `["https://<your-proxy>.vercel.app/*"]`

### 3. Build and load the extension

```bash
pnpm build:extension
```

This runs three Vite builds (popup, background, content — see `extension/vite.config.ts` and
`extension/vite.mv3.config.ts` for why they're separate) into `extension/dist/`.

Then in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select `extension/dist`

For iterative development, `pnpm dev:extension` runs all three builds in watch mode — reload the
extension (and the page you're testing on) after each rebuild.

## Scope / known limitations (v1)

- Single active tab only — no cross-tab or cross-page search.
- The relevance floor, result count and whether the sentence-level refine pass runs are all keyed
  to the query's shape — one word, a phrase, or a question. See `extension/src/query-shape.ts`;
  the reasoning is in `docs/ARCHITECTURE.md`.
- A page with no answer shows "Nothing on this page matched closely enough" rather than a list of
  confidently-ranked irrelevant passages.
- Results are labelled **Exact** (the passage contains your words) or **Semantic** (Jev matched it
  on meaning), and highlighted in amber or purple to match.
- **Tables are not extracted yet.** On a reference-heavy page that is a real gap — roughly 45% of
  the text is currently extracted, and a data table can be exactly what a query wants.
- No caching or persistence between page loads; every search re-extracts and re-scores.
- No auth — the proxy is open, but it is **rate limited**: 60 Jev calls per minute per IP, and a
  stricter 30 per browser install, metered in model calls rather than HTTP requests. Needs an
  Upstash Redis database; see `docs/DEPLOYMENT.md`.
- Pages with more extractable text than Jev's ~32k token budget allows return a clear error in
  the popup instead of a partial/broken search (see `estimateRequestTokens` in both
  `extension/src/config.ts` and `proxy/lib/jev.ts`).

## Tooling

- **pnpm workspace** — `extension/` and `proxy/` as workspace packages.
- **ESLint (flat config) + Prettier**, run via **lint-staged** on a **husky** pre-commit hook.
- **commitlint** (`@commitlint/config-conventional`) on a husky `commit-msg` hook — non-conventional
  commit messages are rejected.

Useful root scripts: `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm build`.

See `CLAUDE.md` for architecture rationale and the exact Jev/AI SDK API this project depends on.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — message contracts and request/response shapes
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — full proxy/extension deployment walkthrough
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup, commit conventions, pre-PR checklist
- [`LICENSE`](LICENSE) — MIT
