import { PROXY_SEARCH_URL } from '../config';
import { extractTerms, hasExactMatch } from '../lexical';
import { policyFor } from '../query-shape';
import type {
  BackgroundRequest,
  BackgroundResponse,
  Chunk,
  ContentRequest,
  ContentResponse,
  RankedResult,
} from '../types';

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab.id;
}

async function extractChunks(tabId: number): Promise<Chunk[]> {
  // Injected on demand under activeTab, rather than declared as a static
  // content_scripts entry in the manifest, so the extension never needs
  // host_permissions beyond the proxy's own origin.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });

  const request: ContentRequest = { type: 'EXTRACT' };
  const response = (await chrome.tabs.sendMessage(tabId, request)) as ContentResponse;

  if (response.type === 'ERROR') {
    const message =
      response.reason === 'TOO_MUCH_TEXT'
        ? 'This page has too much text to search in one request. Try a shorter page or a more specific section.'
        : 'No readable text was found on this page.';
    throw new Error(message);
  }

  return response.chunks;
}

interface ProxyScoreResponse {
  ok: boolean;
  scores?: Array<{ id: string; score: number; span?: string }>;
  coverage?: { scored: number; total: number };
  error?: string;
}

async function scoreChunks(query: string, chunks: Chunk[]): Promise<RankedResult[]> {
  // The query's shape decides how strict to be and whether the sentence-level
  // refine pass is worth paying for. See extension/src/query-shape.ts.
  const policy = policyFor(query);

  let res: Response;
  try {
    res = await fetch(PROXY_SEARCH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        chunks: chunks.map(({ id, text }) => ({ id, text })),
        refine: policy.refine,
        minScore: policy.minScore,
      }),
    });
  } catch {
    throw new Error('Could not reach the search proxy. Check your connection and try again.');
  }

  const body = (await res.json().catch(() => null)) as ProxyScoreResponse | null;

  if (!res.ok || !body?.ok || !body.scores) {
    throw new Error(body?.error ?? `Search failed (HTTP ${res.status}).`);
  }

  // A batch can fail upstream and leave part of the page unsearched. Surfacing
  // it beats silently reporting a confident answer drawn from 60% of the page.
  if (body.coverage && body.coverage.scored < body.coverage.total) {
    console.warn(
      `PageLens: only ${body.coverage.scored} of ${body.coverage.total} passages were scored.`,
    );
  }

  const scoredById = new Map(body.scores.map((s) => [s.id, s]));
  const terms = extractTerms(query);

  return chunks
    .map((chunk) => {
      const scored = scoredById.get(chunk.id);
      return {
        id: chunk.id,
        ref: chunk.ref,
        text: chunk.text,
        score: scored?.score ?? 0,
        // Classified here, from text we already hold: no model call needed to
        // know whether a passage literally contains what was typed.
        matchKind: hasExactMatch(chunk.text, terms) ? ('exact' as const) : ('semantic' as const),
        span: scored?.span,
      };
    })
    .filter((result) => result.score >= policy.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, policy.topN);
}

chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse) => void) => {
    if (message.type === 'SEARCH') {
      void (async () => {
        try {
          const tabId = await getActiveTabId();
          const chunks = await extractChunks(tabId);
          const results = await scoreChunks(message.query, chunks);

          sendResponse({ type: 'RESULTS', results });

          if (results.length > 0) {
            // A question is answered by a sentence, not by its own words
            // scattered across the page, so it sends no terms to mark and
            // leans on the refine pass's answer span instead.
            const policy = policyFor(message.query);
            const highlight: ContentRequest = {
              type: 'HIGHLIGHT',
              results,
              terms: policy.markTerms ? extractTerms(message.query) : [],
            };
            await chrome.tabs.sendMessage(tabId, highlight);
          }
        } catch (error) {
          sendResponse({
            type: 'ERROR',
            error: error instanceof Error ? error.message : 'Search failed.',
          });
        }
      })();
      return true; // keep the message channel open for the async response
    }

    if (message.type === 'JUMP') {
      void (async () => {
        const tabId = await getActiveTabId();
        const jump: ContentRequest = { type: 'JUMP', ref: message.ref };
        await chrome.tabs.sendMessage(tabId, jump);
      })();
      return false;
    }

    return false;
  },
);
