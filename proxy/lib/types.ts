export interface Chunk {
  id: string;
  text: string;
}

export interface SearchRequestBody {
  query: string;
  chunks: Chunk[];
  /**
   * Run the second, sentence-level pass over the best-scoring chunks. The
   * extension sets this from the query's shape: a one-word topic lookup is
   * served fine by a whole-block highlight, so it skips the extra Jev call.
   */
  refine?: boolean;
  /**
   * The relevance floor the caller is about to apply. Chunks below it get
   * filtered out client-side anyway, so refining them would spend a Jev call
   * on passages nobody will ever see. The extension owns the value; the proxy
   * just avoids wasting work on what it is told will be discarded.
   */
  minScore?: number;
}

export interface ScoredChunk {
  id: string;
  score: number;
  /** The sentence within this chunk that best answers the query. Only set for
   *  chunks the refine pass actually looked at. */
  span?: string;
}

export interface Coverage {
  /** Chunks that came back with a score. */
  scored: number;
  /** Chunks the caller sent. */
  total: number;
}

export type SearchResponseBody =
  { ok: true; scores: ScoredChunk[]; coverage: Coverage } | { ok: false; error: string };
