export interface Chunk {
  id: string;
  text: string;
}

export interface SearchRequestBody {
  query: string;
  chunks: Chunk[];
}

export type SearchResponseBody =
  { ok: true; scores: Array<{ id: string; score: number }> } | { ok: false; error: string };
