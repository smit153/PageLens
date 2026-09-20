<div align="center">

```
 ____      _      ____  _____  _      _____  _   _  ____
|  _ \    / \    / ___|| ____|| |    | ____|| \ | |/ ___|
| |_) |  / _ \  | |  _ |  _|  | |    |  _|  |  \| |\___ \
|  __/  / ___ \ | |_| || |___ | |___ | |___ | |\  | ___) |
|_|    /_/   \_\ \____||_____||_____||_____||_| \_||____/
```

**Semantic `Ctrl+F` for any web page.**

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Chrome Manifest V3](https://img.shields.io/badge/chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](extension/public/manifest.json)
[![TypeScript](https://img.shields.io/badge/typescript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![pnpm workspace](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](pnpm-workspace.yaml)
[![Vercel Edge](https://img.shields.io/badge/vercel-Edge%20Function-000000?logo=vercel&logoColor=white)](proxy/api/search.ts)
[![Powered by Jev](https://img.shields.io/badge/powered%20by-Jev-6E56CF)](https://typesafe.ai)

_Ask a question, get the passage that answers it — ranked, scored, and marked on the page._

<!-- Deliberately a bare URL on its own line: that is the only form GitHub renders
     as an inline video player. Wrapping it in a markdown link turns it back into a
     link, and a <video> tag is stripped by GitHub's sanitiser. -->

https://github.com/user-attachments/assets/31c56d2d-fbb5-43ed-8219-b11f82088cc0

</div>

Asking **"why are plants green"** on Wikipedia's _Photosynthesis_ article. The word "green"
appears dozens of times on that page, so `Ctrl+F` gives you dozens of places to start reading.
PageLens returns the one sentence that actually answers the question — _"The green part of the
light spectrum is not absorbed but is reflected, which is the reason that most plants have a
green color"_ — scores it, and marks it in place.

The popup ranks passages, labels whether each matched on wording (**Exact**) or on meaning
(**Semantic**), and clicking a result scrolls the page to it.

## Why PageLens?

`Ctrl+F` matches characters. It cannot find "how much does it cost" on a page that says
"billed annually at $90 a seat", because those two things share no words at all.

The usual fix is to send the page to a chat model and hope the prose that comes back is faithful.
PageLens does something narrower and more reliable: it asks
[TypeSafe AI's Jev](https://typesafe.ai/) — a typed decision model that returns **calibrated
scores against a rubric, not generated text** — how relevant each passage is, and ranks by the
number that comes back.

That difference is the whole design:

|                          | Chat model              | PageLens / Jev                                 |
| ------------------------ | ----------------------- | ---------------------------------------------- |
| Returns                  | prose you have to parse | a score from 0 to 3 per passage                |
| Can it invent an answer? | yes                     | no — it only ranks text already on the page    |
| Cost per search          | one large prompt        | one scored question per passage, batched       |
| Shows its work           | you trust the summary   | every result is highlighted where it came from |

Nothing is summarised, so nothing can be fabricated. Every result is a passage that is genuinely
on the page, highlighted where it sits.

## Getting started

```bash
git clone https://github.com/smit153/PageLens.git
cd PageLens
pnpm install
```

PageLens has two halves: a Chrome extension, and a small proxy that holds your API key. The proxy
has to be running before the extension can search anything.

```bash
# terminal 1 — the proxy
cp proxy/.env.local.example proxy/.env.local   # then fill in AI_GATEWAY_API_KEY
pnpm dev:proxy                                  # http://localhost:3000/api/search

# terminal 2 — the extension
pnpm build:extension                            # then load extension/dist at chrome://extensions
```

> **Full walkthrough in [`docs/SETUP.md`](docs/SETUP.md)** — credentials, deploying the proxy,
> loading the extension, and a troubleshooting table keyed by the exact error you see.

### Run modes

| Mode         | Best for     | Proxy runs on          | Rate limiter                             | Command                               |
| ------------ | ------------ | ---------------------- | ---------------------------------------- | ------------------------------------- |
| **Local**    | developing   | Node, `localhost:3000` | `RATE_LIMIT_DISABLED=1`, or real Upstash | `pnpm dev:proxy`                      |
| **Deployed** | everyday use | Vercel Edge Function   | Upstash Redis, **required**              | `pnpm --filter pagelens-proxy deploy` |

> **The deployed proxy is public and spends real money.** It is unauthenticated by design — the
> extension ships no credentials — so it is rate limited by IP and by browser install, and it
> **fails closed**: if the limiter cannot be reached, the request is refused rather than billed.
> Set a spend cap on your AI Gateway before pointing anyone else at it.

## Architecture

```mermaid
flowchart TD
    subgraph EXT["Chrome extension — ships no credentials"]
        P["Popup<br/>query box, ranked results"]
        B["Background service worker<br/>orchestrator"]
        C["Content script<br/>injected on demand"]
    end
    subgraph SRV["Your proxy — holds the API key"]
        X["Vercel Edge Function"]
        L["Rate limiter<br/>Upstash sliding window"]
        J["typesafe-ai/jev<br/>via Vercel AI Gateway"]
    end
    P -->|"query"| B
    B -->|"extract"| C
    C -->|"every passage on the page"| B
    B -->|"POST query + chunks"| X
    X --> L
    L -->|"429 if over budget"| X
    X -->|"parallel batches"| J
    J -->|"score 0-3 per passage"| X
    X -->|"scores, spans"| B
    B -->|"ranked results"| P
    B -->|"highlight + scroll"| C
```

| Piece             | Runs in              | Responsibility                                               |
| ----------------- | -------------------- | ------------------------------------------------------------ |
| Popup             | extension page       | takes the query, renders results and match-kind pills        |
| Background worker | MV3 service worker   | orchestrates everything; the only piece that calls the proxy |
| Content script    | the active tab       | extracts passages, highlights matches, scrolls               |
| Proxy             | Vercel Edge Function | holds the key, batches passages, calls Jev                   |
| Rate limiter      | Upstash Redis        | meters searches in Jev calls, not HTTP requests              |

Three details that are load-bearing rather than incidental:

- **No static `content_scripts` entry.** The content script is injected on demand under
  `activeTab`, so the extension needs no broad host permissions — only your own proxy's origin.
- **The whole page is scored, not a sample.** The proxy splits passages into batches that each fit
  a Jev call and fans them out in parallel.
- **Cost is metered in model calls.** One request can be nine Jev calls, so the rate limiter
  charges what a request actually costs.

## Documentation

| Document                                       | What is in it                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| [`docs/SETUP.md`](docs/SETUP.md)               | Step-by-step setup, from clone to searching, plus troubleshooting  |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Message contracts, request/response shapes, rate-limit tiers       |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)     | Deploying the proxy, env vars, build-error reference               |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)           | Dev setup, commit conventions, pre-PR checklist                    |
| [`CLAUDE.md`](CLAUDE.md)                       | Why the code is shaped this way, and the exact Jev/AI SDK contract |

## Scope and known limitations

- **Single active tab** — no cross-tab or cross-page search.
- **Tables are not extracted yet.** On a reference-heavy page that is a real gap: roughly 45% of
  the text is currently extracted, and a data table can be exactly what a query wants.
- **No caching between page loads** — every search re-extracts and re-scores.
- **Query shape drives the policy.** The relevance floor, result count, and whether the
  sentence-level refine pass runs are keyed to whether you typed one word, a phrase, or a
  question. See `extension/src/query-shape.ts`.
- **No answer means no answer.** A page with nothing relevant says so, rather than listing
  confidently-ranked irrelevant passages.
- **The proxy is open but limited** — 60 Jev calls per minute per IP, 30 per browser install.
  There is no auth; the limiter is cost control, not authentication.

## Tooling

- **pnpm workspace** — `extension/` and `proxy/` as independent packages, no shared build.
- **ESLint (flat config) + Prettier**, via **lint-staged** on a husky pre-commit hook.
- **commitlint** (`@commitlint/config-conventional`) on a husky commit-msg hook.

```bash
pnpm lint         # eslint across the workspace
pnpm format       # prettier --write
pnpm typecheck    # tsc --noEmit in both packages
pnpm build        # builds the extension; the proxy needs no build step
```

## Contributing

Issues and pull requests are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — commit
messages are linted, so a non-conventional message is rejected by the hook rather than by review.

## License

[MIT](LICENSE).
