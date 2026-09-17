import { PROXY_SEARCH_URL, TOP_N_RESULTS } from '../config';
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
  scores?: Array<{ id: string; score: number }>;
  error?: string;
}

async function scoreChunks(query: string, chunks: Chunk[]): Promise<RankedResult[]> {
  let res: Response;
  try {
    res = await fetch(PROXY_SEARCH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, chunks: chunks.map(({ id, text }) => ({ id, text })) }),
    });
  } catch {
    throw new Error('Could not reach the search proxy. Check your connection and try again.');
  }

  const body = (await res.json().catch(() => null)) as ProxyScoreResponse | null;

  if (!res.ok || !body?.ok || !body.scores) {
    throw new Error(body?.error ?? `Search failed (HTTP ${res.status}).`);
  }

  const scoreById = new Map(body.scores.map((s) => [s.id, s.score]));

  return chunks
    .map((chunk) => ({
      id: chunk.id,
      ref: chunk.ref,
      text: chunk.text,
      score: scoreById.get(chunk.id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N_RESULTS);
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
            const highlight: ContentRequest = { type: 'HIGHLIGHT', results };
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
