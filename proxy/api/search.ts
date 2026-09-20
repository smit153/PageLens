import { experimental_evaluate as evaluate } from 'ai';
import type { Chunk, ScoredChunk, SearchRequestBody, SearchResponseBody } from '../lib/types.ts';
import {
  MAX_BATCHES,
  MAX_CHUNKS,
  REFINE_TOP_N,
  RELEVANCE_RUBRIC,
  batchChunks,
} from '../lib/jev.ts';
import { splitSentences } from '../lib/sentences.ts';
import { checkLimit, identify } from '../lib/rate-limit.ts';

export const config = { runtime: 'edge' };

function jsonResponse(
  body: SearchResponseBody,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
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

/**
 * One extra retry with a pause, on top of the AI SDK's own.
 *
 * The gateway returns transient 503s, and the SDK's three attempts can all land
 * inside a couple of hundred milliseconds -- too fast to outlast a blip. A
 * dropped batch means a slice of the page silently goes unsearched, so it is
 * worth one slower attempt before giving up on it.
 */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 750));
    return run();
  }
}

/**
 * Scores one batch of chunks in a single Jev call, returning id to score pairs.
 *
 * Each question names its own chunk id. That is load-bearing, not decoration:
 * every question in a call shares one state containing the whole batch, so
 * without the id nothing distinguishes them and Jev returns near-identical
 * scores for all of them.
 */
async function scoreBatch(query: string, batch: Chunk[]): Promise<Array<[string, number]>> {
  const result = await evaluate({
    model: 'typesafe-ai/jev',
    state: { query, chunks: batch.map(({ id, text }) => ({ id, text })) },
    questions: Object.fromEntries(
      batch.map((chunk) => [
        chunk.id,
        {
          type: 'score' as const,
          instructions: `How relevant is the passage with id "${chunk.id}" to the search query: "${query}"?`,
          criteria: RELEVANCE_RUBRIC,
        },
      ]),
    ),
  });

  return batch.map((chunk) => {
    const answer = result.answers[chunk.id];
    return [chunk.id, answer && answer.type === 'score' ? answer.score : 0];
  });
}

/**
 * Second pass of a coarse-to-fine search: narrows the best-scoring chunks from
 * a passage to the single sentence that answers the query.
 *
 * One `choice` question per chunk, all sharing a single state, so the whole
 * refinement is one extra Jev call regardless of how many chunks qualify.
 * Mutates `scores` in place, setting `span` where a sentence was picked.
 *
 * Deliberately non-fatal: a failure here costs precision, not the search, so
 * the caller still returns pass one's ranking.
 */
async function attachAnswerSpans(
  query: string,
  chunks: Chunk[],
  scores: ScoredChunk[],
  minScore: number,
): Promise<void> {
  const textById = new Map(chunks.map((chunk) => [chunk.id, chunk.text]));

  const candidates = [...scores]
    .filter((scored) => scored.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, REFINE_TOP_N)
    .map((scored) => ({ scored, sentences: splitSentences(textById.get(scored.id) ?? '') }))
    // A single-sentence passage is already its own answer span.
    .filter((candidate) => candidate.sentences.length > 1);

  if (candidates.length === 0) return;

  const questions = Object.fromEntries(
    candidates.map(({ scored, sentences }) => [
      scored.id,
      {
        type: 'choice' as const,
        instructions: `In the passage with id "${scored.id}", which sentence best answers the search query: "${query}"?`,
        criteria: Object.fromEntries(sentences.map((text, index) => [`s${index}`, text])),
      },
    ]),
  );

  try {
    const result = await evaluate({
      model: 'typesafe-ai/jev',
      state: {
        query,
        passages: candidates.map(({ scored, sentences }) => ({ id: scored.id, sentences })),
      },
      questions,
    });

    for (const { scored, sentences } of candidates) {
      const answer = result.answers[scored.id];
      if (!answer || answer.type !== 'choice') continue;

      const index = Number.parseInt(answer.choice.slice(1), 10);
      const sentence = sentences[index];
      if (sentence) scored.span = sentence;
    }
  } catch (error) {
    console.error('Jev refine pass failed; falling back to block-level results:', error);
  }
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

  const batches = batchChunks(query, chunks);
  if (batches.length > MAX_BATCHES) {
    console.warn(
      `Page needs ${batches.length} batches; scoring the first ${MAX_BATCHES} and dropping the rest.`,
    );
    batches.length = MAX_BATCHES;
  }

  // Metered after batching, because the cost of a request is not known until
  // then, but before the fan-out, because that is the first thing that spends
  // money. Everything between validation and here is local and free.
  //
  // The refine pass is charged optimistically when it is requested: whether it
  // finds any candidate worth refining is only knowable after pass one, and
  // over-charging by one call is the safe direction to be wrong in.
  const cost = batches.length + (body.refine === true ? 1 : 0);
  const verdict = await checkLimit(identify(request), cost);

  if (!verdict.ok) {
    const error =
      verdict.reason === 'over-limit'
        ? `Too many searches. Try again in ${verdict.retryAfter}s.`
        : 'Search is temporarily unavailable. Please try again shortly.';

    return jsonResponse(
      { ok: false, error, retryAfter: verdict.retryAfter },
      verdict.reason === 'over-limit' ? 429 : 503,
      { 'retry-after': String(verdict.retryAfter) },
    );
  }

  // Fanned out concurrently, so covering the whole page costs roughly the
  // latency of one call rather than the sum of them.
  const settled = await Promise.allSettled(
    batches.map((batch) => withRetry(() => scoreBatch(query, batch))),
  );

  const scored = new Map<string, number>();
  let failures = 0;
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      for (const [id, score] of outcome.value) scored.set(id, score);
    } else {
      failures += 1;
      console.error('Batch failed:', outcome.reason);
    }
  }

  // Partial coverage still beats no answer, so only a total wipeout is fatal.
  if (failures === settled.length) {
    return jsonResponse(
      { ok: false, error: 'The relevance model call failed. Please try again.' },
      502,
    );
  }

  const scores: ScoredChunk[] = chunks
    .filter((chunk) => scored.has(chunk.id))
    .map((chunk) => ({ id: chunk.id, score: scored.get(chunk.id) ?? 0 }));

  if (body.refine === true) {
    const minScore = typeof body.minScore === 'number' ? body.minScore : 0;
    await attachAnswerSpans(query, chunks, scores, minScore);
  }

  const coverage = { scored: scores.length, total: chunks.length };
  if (coverage.scored < coverage.total) {
    console.warn(`Partial coverage: scored ${coverage.scored} of ${coverage.total} chunks.`);
  }

  return jsonResponse({ ok: true, scores, coverage }, 200);
}
