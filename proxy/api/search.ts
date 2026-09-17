import { experimental_evaluate as evaluate } from 'ai';
import type { Chunk, SearchRequestBody, SearchResponseBody } from '../lib/types';
import { MAX_CHUNKS, MAX_STATE_TOKENS, RELEVANCE_RUBRIC, estimateRequestTokens } from '../lib/jev';

export const config = { runtime: 'edge' };

function jsonResponse(body: SearchResponseBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isValidChunk(value: unknown): value is Chunk {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.text === 'string' &&
    candidate.text.trim().length > 0
  );
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Only POST is supported.' }, 405);
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return jsonResponse(
      { ok: false, error: 'Proxy is misconfigured: AI_GATEWAY_API_KEY is not set.' },
      500,
    );
  }

  let body: SearchRequestBody;
  try {
    body = (await request.json()) as SearchRequestBody;
  } catch {
    return jsonResponse({ ok: false, error: 'Request body must be JSON.' }, 400);
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const chunks = Array.isArray(body.chunks) ? body.chunks.filter(isValidChunk) : [];

  if (!query) {
    return jsonResponse({ ok: false, error: 'A search query is required.' }, 400);
  }
  if (chunks.length === 0) {
    return jsonResponse({ ok: false, error: 'No page passages were provided.' }, 400);
  }
  if (chunks.length > MAX_CHUNKS) {
    return jsonResponse(
      {
        ok: false,
        error: `Too many passages (${chunks.length}); the proxy accepts at most ${MAX_CHUNKS}.`,
      },
      400,
    );
  }
  if (estimateRequestTokens(query, chunks) > MAX_STATE_TOKENS) {
    return jsonResponse(
      { ok: false, error: 'This page has too much text to search in one request.' },
      413,
    );
  }

  const questions = Object.fromEntries(
    chunks.map((chunk) => [
      chunk.id,
      {
        type: 'score' as const,
        instructions: `How relevant is this passage to the search query: "${query}"?`,
        criteria: RELEVANCE_RUBRIC,
      },
    ]),
  );

  try {
    const result = await evaluate({
      model: 'typesafe-ai/jev',
      state: { query, chunks: chunks.map(({ id, text }) => ({ id, text })) },
      questions,
    });

    const scores = chunks.map((chunk) => {
      const answer = result.answers[chunk.id];
      const score = answer && answer.type === 'score' ? answer.score : 0;
      return { id: chunk.id, score };
    });

    return jsonResponse({ ok: true, scores }, 200);
  } catch (error) {
    console.error('Jev evaluate() call failed:', error);
    return jsonResponse(
      { ok: false, error: 'The relevance model call failed. Please try again.' },
      502,
    );
  }
}
