# PageLens

An in-page semantic search Chrome extension. Type a query in the popup and PageLens finds the
most relevant passages on the current tab, scored by [TypeSafe AI's Jev
model](https://typesafe.ai/) (a typed decision model — it returns scores against a rubric, not
generated text) via the Vercel AI SDK's `experimental_evaluate()`.

## How it works

1. **Content script** walks the visible DOM (paragraphs, list items, headings — skipping
   nav/footer/script/style), and uses LangChain's `RecursiveCharacterTextSplitter` to break long
   blocks into passages. Output is capped at 40 chunks, sampled evenly across the page so long
   pages don't just lose their tail.
2. **Popup** sends the query to the **background service worker**.
3. **Background worker** injects the content script (via `activeTab` + `scripting`, granted when
   you open the popup — no broad host permissions needed), collects the chunks, and POSTs
   `{ query, chunks }` to the **proxy**.
4. **Proxy** (a Vercel Edge Function) builds one `evaluate()` call to `typesafe-ai/jev`: one
   `score` question per chunk, rubric `not relevant / somewhat relevant / relevant / highly
relevant`. It returns each chunk's score.
5. **Background worker** ranks chunks by score, sends the top 8 to the popup and back to the
   content script.
6. **Content script** highlights and auto-scrolls to the #1 result. The popup lists all returned
   results with a snippet each; clicking one scrolls the page to that passage.

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

Get a key from your Vercel team's **AI Gateway → API Keys** page (requires a Vercel account and
a team with AI Gateway credits). For local development:

```bash
pnpm dev:proxy   # runs `vercel dev` from the repo root
```

To deploy:

```bash
pnpm --filter pagelens-proxy deploy   # runs `vercel deploy --prod`
```

On first deploy, also set `AI_GATEWAY_API_KEY` in the Vercel project's **Settings → Environment
Variables** (the `.env.local` file only covers local `vercel dev`).

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
- No caching or persistence between page loads; every search re-extracts and re-scores.
- No auth — the proxy is open. **Rate limiting was intentionally left out of v1** (see
  `CLAUDE.md` for why); if you deploy this publicly, add one before relying on it.
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
