# Architecture

PageLens has three runtime pieces talking over `chrome.runtime` messaging and one HTTP hop to a
proxy. This document covers the message contracts and request/response shapes in detail; see the
root `README.md` for setup and `CLAUDE.md` for the reasoning behind specific design choices.

## Components

| Component         | Where it runs                                | File                                |
| ----------------- | -------------------------------------------- | ----------------------------------- |
| Popup             | Extension page (its own tab-like context)    | `extension/src/popup/`              |
| Background worker | MV3 service worker                           | `extension/src/background/index.ts` |
| Content script    | Injected into the active tab, isolated world | `extension/src/content/`            |
| Proxy             | Vercel Edge Function                         | `proxy/api/search.ts`               |

## Sequence

```
User types a query and submits the popup form
  |
  v
popup --SEARCH{query}--> background
                            |
                            |-- chrome.scripting.executeScript(content.js) --> tab
                            |-- EXTRACT --------------------------------------> content script
                            |                                                        |
                            |                                          walk DOM, chunk text
                            |                                                        |
                            |<-- CHUNKS{chunks} or ERROR{reason} --------------------|
                            |
                            |-- POST {query, chunks} --> proxy
                            |                              |
                            |                    one evaluate() call to typesafe-ai/jev,
                            |                    one `score` question per chunk
                            |                              |
                            |<-- {ok, scores[]} -----------|
                            |
                            |-- rank, take top 8
                            |
  |<-- RESULTS{results} ----|
  v                         |
popup renders list          |-- HIGHLIGHT{results} --> content script
                                                            |
                                                  highlight #1, scroll to it

User clicks a result snippet in the popup
  |
  v
popup --JUMP{ref}--> background --JUMP{ref}--> content script (scrolls to that ref)
```

## Message contracts

All types live in `extension/src/types.ts`.

**Popup -> background** (`BackgroundRequest`):

```ts
{
  type: 'SEARCH';
  query: string;
}
{
  type: 'JUMP';
  ref: string;
}
```

**Background -> popup** (`BackgroundResponse`, sent as the reply to a `SEARCH`):

```ts
{ type: 'RESULTS'; results: RankedResult[] }
{ type: 'ERROR'; error: string }
```

**Background -> content script** (`ContentRequest`):

```ts
{ type: 'EXTRACT' }
{ type: 'HIGHLIGHT'; results: RankedResult[] }
{ type: 'JUMP'; ref: string }
```

**Content script -> background** (`ContentResponse`, sent as the reply to `EXTRACT`):

```ts
{ type: 'CHUNKS'; chunks: Chunk[] }
{ type: 'ERROR'; reason: 'TOO_MUCH_TEXT' | 'NO_CONTENT' }
```

`Chunk` and `RankedResult`:

```ts
interface Chunk {
  id: string; // e.g. "c3"
  text: string;
  ref: string; // matches a data-pagelens-id attribute on the source element
}

interface RankedResult extends Chunk {
  score: number; // 0..(criteria.length - 1), interpolated
}
```

## Proxy request/response

`POST /api/search` (types in `proxy/lib/types.ts`):

```ts
// request
{
  query: string;
  chunks: Array<{ id: string; text: string }>;
}

// response
{
  ok: true;
  scores: Array<{ id: string; score: number }>;
}
{
  ok: false;
  error: string;
}
```

The proxy builds exactly one `evaluate()` call per search: a single shared `state` (`{ query,
chunks }`) and one `score` question per chunk, rubric `not relevant / somewhat relevant /
relevant / highly relevant`. See `proxy/api/search.ts` and `CLAUDE.md`'s "External API reference"
section for the underlying `experimental_evaluate()` contract.

## Why chunk `ref`s are DOM attributes, not selectors

Every extracted block gets `data-pagelens-id="pl-N"` set on it at extraction time
(`extension/src/content/extract.ts`). Scrolling back to a result is just
`querySelector('[data-pagelens-id="pl-N"]')`. When a block is long enough to be split into
multiple chunks (`extension/src/content/chunk.ts`, via LangChain's
`RecursiveCharacterTextSplitter`), every resulting chunk keeps the same `ref` — they all point
back to the one DOM element they came from.
