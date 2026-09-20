# PageLens

In-page semantic search Chrome extension. Query in the popup -> ranked, highlighted passages on
the current page, scored by TypeSafe AI's Jev model via a Vercel Edge Function proxy.

Full user-facing setup steps live in `README.md`. This file is architecture rationale and the
external API reference for future sessions.

## Repo layout

pnpm workspace, two packages:

- `extension/` — MV3 Chrome extension (TypeScript, Vite). No bundler magic beyond plain Vite.
- `proxy/` — Vercel Edge Function (TypeScript, `ai` SDK). Deployed independently of the extension.

They share no code and no workspace dependency on each other — see "Duplicated constants" below
for why.

## Flow

```
popup --SEARCH{query}--> background --executeScript+EXTRACT--> content script
                             |                                      |
                             |<------------ all chunks -------------|
                             |
                             |--POST {query, chunks, refine, minScore}--> proxy
                             |                                             |
                             |             parallel batches --evaluate()--> Jev (via AI Gateway)
                             |             optional refine pass --------->  Jev
                             |<------------ scores, spans, coverage -------|
                             |
                             |--RESULTS{ranked}--> popup (list + match-kind pills)
                             |--HIGHLIGHT{results, terms}--> content script (marks every result)

popup --JUMP{ref}--> background --JUMP--> content script (scrolls to that ref)
```

Message contracts are in `extension/src/types.ts` (`BackgroundRequest`/`Response`,
`ContentRequest`/`Response`).

## Key decisions and why

**No static `content_scripts` manifest entry.** The spec called for minimal permissions
(`activeTab`, `scripting`, `host_permissions` only for the proxy's own origin — no broad host
access). A statically declared `content_scripts` block would need matching `host_permissions` for
every site it runs on. Instead, `background/index.ts` injects `content.js` on demand via
`chrome.scripting.executeScript`, riding on the `activeTab` grant from the user opening the popup
(which counts as "invoking the extension"). This re-injects on every search rather than once per
page load — simpler than trying to detect "already injected," and `content/index.ts` guards
against double-registering its own message listener with `window.__pageLensLoaded`.

**DOM anchors via `data-pagelens-id`, not computed CSS selectors.** Every accepted block gets a
`data-pagelens-id="pl-N"` attribute when extracted. Scrolling later is just
`querySelector('[data-pagelens-id="pl-N"]')`. Far simpler and more robust than building/matching
CSS-path selectors, at the cost of a harmless DOM mutation on the page (cleared and reassigned on
every search — see `extractVisibleBlocks` in `extension/src/content/extract.ts`).

**Background is the orchestrator, per the original spec**, not the popup. Popup only sends
`SEARCH`/`JUMP` and renders whatever comes back. This also means a search survives the popup
closing mid-flight (MV3 popups are ephemeral; the service worker isn't, within its lifetime).

**Two separate Vite configs for background/content (`vite.config.ts` +
`vite.mv3.config.ts`).** The popup is a normal Vite HTML entry. Background and content each need
to ship as one dependency-free IIFE file — Chrome loads them directly, not through a module
graph. They can't be built in a single Rollup invocation with two inputs: both import from
`../config` and `../types`, and Rollup refuses to split a shared chunk across multiple IIFE
outputs. `vite.mv3.config.ts` is invoked twice (`TARGET=background` / `TARGET=content`) using
Vite's single-entry `build.lib` mode instead.

**Chunking uses LangChain's `RecursiveCharacterTextSplitter`** (`@langchain/textsplitters`,
explicit user request), not hand-rolled splitting logic. It only runs on DOM blocks longer than
`CHUNK_SIZE` (400 chars) — most paragraphs/list items pass through as a single chunk with their
own `data-pagelens-id` anchor already attached; splitting a block produces multiple chunks that
all point back to the same anchor (scrolling to any of them lands in the right place). `MAX_CHUNKS`
is now a pathological-page guard rather than a sampling cap — every chunk gets scored, because the
proxy batches them.

**Rate limiting is metered in Jev calls, not HTTP requests** (`proxy/lib/rate-limit.ts`). One
request is not one unit of cost: `batchChunks()` turns a long page into up to `MAX_BATCHES`
concurrent Jev calls plus an optional refine pass, so a request-counting limiter charges a
960-chunk caller the same as a 5-chunk one and undercharges the expensive path by ~9x. The check
sits after batching (the cost isn't known before it) and before the fan-out (the first thing that
spends money); everything in between is local and free.

Upstash Redis backs it rather than an in-memory `Map`, because Edge isolates are per-region and
recycled — an in-process counter silently resets and is never shared, which is protection in
appearance only. `ephemeralCache` still gives that in-process short-circuit as a free first layer
on top of the shared counter.

It **fails closed**: an unreachable Redis means requests can't be metered, and unmetered requests
here are unmetered spend. `RATE_LIMIT_DISABLED=1` is the explicit local-dev opt-out, so missing
credentials never degrade into a silent no-op.

**Every result is marked, auto-scrolling to the best one.** This started as top-1 only, by explicit
user decision, and was reversed once results became precise enough not to be noisy: a passage
listed in the popup could otherwise sit unmarked in plain view on screen. See `highlightResults` in
`extension/src/content/highlight.ts`.

**Duplicated constants/types between `extension/` and `proxy/`** (`MAX_CHUNKS`, the `Chunk`/`score`
shapes) rather than a shared workspace package. The two packages build for completely different
runtimes (browser content script vs. Vercel Edge Function) and deploy independently; a third
`shared` package would need its own build step for both consumers for a handful of small
interfaces/constants. If these ever drift out of sync, that's the tradeoff — check both
`extension/src/config.ts` and `proxy/lib/jev.ts` when changing limits.

The token budget deliberately is **not** duplicated. It lives only in `proxy/lib/jev.ts`, which
owns the Jev contract; the extension just caps total characters as a message-size guard. Two copies
of a number that was already measured wrong once is not a tradeoff worth taking.

## A client-supplied identifier may only narrow a limit, never widen one

The limiter keys on two tiers, and which tier a key can belong to follows entirely from whether the
caller controls it:

- **IP** (`x-forwarded-for`, set by Vercel from the connection) is the authoritative ceiling:
  60 Jev calls/minute. A caller cannot forge it.
- **Install id** (`x-pagelens-install`, a UUID the extension mints into `chrome.storage.local`) is
  a _stricter_ inner tier at 30/minute, checked first so a browser that has blown its own budget
  is rejected without also draining the IP budget it shares behind a NAT.

Omitting the header buys nothing — it drops the extra restriction and leaves the IP ceiling. That
asymmetry is the whole point: a caller-controlled value used as the _sole_ key is not a limit,
because whoever controls it mints fresh buckets on demand.

This is also why **the user-agent is deliberately not part of the key**, despite being the obvious
second signal. Post-UA-reduction it carries almost no entropy (thousands of unrelated users share
one string, so it would bucket them together), and being a caller-set header, including it would
let one attacker multiply their own budget by varying it. It makes the limiter weaker, not
stronger.

`chrome.storage.local` over IndexedDB for the id: identical guarantees (both only bind an honest
client), but extension storage isn't subject to Chrome's best-effort quota eviction, is reachable
directly from the MV3 service worker, and needs no open/upgrade dance. It costs the `storage`
permission, which is not a host permission and raises no install-time warning.

## Jev's usable limits are far below its documented context

Measure before trusting a number here. Two cases have already bitten:

- **Batch size.** The documented context is ~32k tokens, but 89 questions / ~15.1k tokens works
  repeatedly while ~118 questions / ~20k tokens gets persistent 503s. `BATCH_TOKEN_BUDGET` (12k)
  and `MAX_QUESTIONS_PER_BATCH` (80) are set from that, not from the docs. An oversized batch does
  not degrade, it fails outright and silently costs page coverage.
- **The token estimator.** `chars/4 + 40` per question undercounted real usage by ~30%. The model
  in `proxy/lib/jev.ts` (`180 + 79·chunks + 0.25·chars`) is fitted to measured requests.

When changing either, re-measure with `result.usage.inputTokens` rather than reasoning from the
published context window.

## Each question must name its own chunk id

Every question in an `evaluate()` call shares one state containing the whole batch. With identical
instructions, nothing distinguishes them and Jev answers the same question N times — observed as
scores of `2.95, 2.95, 2.96, 2.96` on passages that should have ranged 0 to 3. Naming the id in the
instructions fixed the same four to `0, 3, 0, 1.19`. This applies to both passes.

## Highlighting wraps `mark` elements, not the Custom Highlight API

`CSS.highlights` is tidier and needs no DOM mutation, but a highlight registered from a content
script's isolated world appeared never to reach the page's renderer. That was never confirmed, so
the code does not depend on it.

Since wrapping mutates someone else's DOM, `clearHighlights` must stay exact: it unwraps every mark
and calls `normalize()`, and `textContent` was verified identical before and after. Ranges are
wrapped one text node at a time (`surroundContents` only reliably handles a range that does not
cross element boundaries, and highlighted sentences routinely contain links and citation
superscripts), working backwards through matches because each wrap splits the node.

## Do not reach for Jev where a string operation will do

Query shape (`extension/src/query-shape.ts`) and exact-match classification
(`extension/src/lexical.ts`) are both plain regex work done locally. They are deterministic, free
and instant, and Jev sits _downstream_ of them, so a model call there would cost latency and money
and still not answer better. Jev's judgement is for meaning.

## Local proxy dev uses `dev-server.ts`, not `vercel dev`

`proxy/dev-server.ts` runs `api/search.ts` on Node's built-in HTTP server (native TS support +
`--env-file`), with zero dependencies and no Vercel account. `vercel dev` was tried first and
fails three separate ways in this monorepo — recursion guard, static-output-dir check, and the
repo-level link pointing at the git root instead of `proxy/`. All three are documented with their
error codes in `docs/DEPLOYMENT.md`; read that before re-attempting `vercel dev`.

Consequences to keep in mind when editing `proxy/`:

- **No `build` script in `proxy/package.json`.** Adding one makes Vercel treat the project as a
  static site and fail on a missing `public/` directory. The root `build` script uses
  `pnpm -r --if-present run build` so the proxy is simply skipped.
- **`api/` and `lib/` imports use explicit `.ts` extensions** (with `allowImportingTsExtensions`
  in `proxy/tsconfig.json`), because Node's ESM resolver requires them. Verified to still bundle
  cleanly under esbuild, which is what Vercel's function builder uses.
- **`dev-server.ts` sits outside `tsconfig.json`'s `include`** (which covers only `api` and
  `lib`), so it isn't type-checked and Node's globals don't leak into the Edge-targeted code.

## TypeScript is pinned to 6.0.3, not the latest 7.x

`typescript` 7.x (the Go-ported "tsgo" compiler) is the current npm `latest` tag, and `tsc
--noEmit` works fine with it. But `typescript-eslint@8.70.0`'s peer range is `>=4.8.4 <6.1.0` —
it depends on TS's internal compiler APIs, which changed in the 7.x rewrite, and linting fails
outright on 7.x (`typescript-eslint does not support TS 7.0`, verified in this repo). All three
`package.json`s pin `typescript` to `^6.0.3` for that reason. Bump it only once
typescript-eslint supports 7.x (tracked at
https://github.com/typescript-eslint/typescript-eslint/issues/10940) — check `npm view
typescript-eslint peerDependencies` before doing so.

## External API reference: Jev / AI SDK `experimental_evaluate()`

Jev launched 2026-09-15 (TypeSafe AI, "System One model" — returns typed decisions, not text) and
AI SDK 7 added `experimental_evaluate()` to call it. **This postdates most models' training data
— don't guess at this API from general AI SDK knowledge, it's genuinely new.** If anything below
looks stale, re-check https://ai-sdk.dev/docs/reference/ai-sdk-core/evaluate and
https://vercel.com/docs/ai-gateway/modalities/evaluation before changing the proxy.

```ts
import { experimental_evaluate as evaluate } from 'ai'; // package: "ai", v7+

const result = await evaluate({
  model: 'typesafe-ai/jev', // string form routes through AI Gateway
  state: /* string | object | array */ { query, chunks },
  questions: {
    // Record<string, Question>; each key becomes a key in result.answers
    someId: {
      type: 'score', // or "choice" | "boolean"
      instructions: 'How relevant is this passage to the search query?',
      criteria: ['not relevant', 'somewhat relevant', 'relevant', 'highly relevant'], // low -> high
    },
  },
});

result.answers.someId; // { type: 'score', score: 2.86, probabilities: { '0':0, '1':0.02, ... } }
result.usage; // { inputTokens, outputTokens, totalTokens }
```

Question types:

- `score` — `criteria: string[]`, >=2 labels, low to high. Answer: `{ score: number, probabilities }`.
- `choice` — `criteria: Record<optionName, description>`. Answer: `{ choice: string, probabilities }`.
- `boolean` — `criteria?: { true: string; false: string }`. Answer: `{ probability: number }`.

Multiple questions can share one `state` and are answered in a single round trip — this project
uses exactly one `evaluate()` call per search, with one `score` question per chunk (see
`proxy/api/search.ts`).

**Auth**: set `AI_GATEWAY_API_KEY` in the environment (Vercel project env vars for the deployed
function, `.env.local` for local `vercel dev`). The plain string model form picks this up
automatically — no explicit provider wiring needed. (OIDC via `vercel env pull` also works but
expires after 12h locally; the API key is simpler for both local dev and prod, so that's what
this project uses.)

**Runtime**: works in Vercel's Edge Runtime — it's a `fetch()` call under the hood, no Node-only
APIs required. `proxy/tsconfig.json` uses `"lib": ["ES2022", "WebWorker"]` (not `"DOM"`) to match
what Edge Functions actually have (`Request`/`Response`/`fetch`/`crypto`, no `document`/`window`).
`proxy/lib/env.d.ts` hand-declares just `process.env` typing rather than pulling in `@types/node`
for a Worker-like environment.

**HTTP API** (non-AI-SDK clients): `POST https://ai-gateway.vercel.sh/v1/evaluate` with the same
`{ model, state, questions }` body, `Authorization: Bearer $AI_GATEWAY_API_KEY`. Not used here,
but documented in case the proxy ever needs to drop the `ai` package dependency.
