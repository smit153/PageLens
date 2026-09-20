export interface Chunk {
  id: string;
  text: string;
  /** Value of the data-pagelens-id attribute on the source DOM element. */
  ref: string;
}

/**
 * How a passage earned its place. `exact` means it literally contains a query
 * term, `semantic` means Jev ranked it on meaning alone -- the "search cost,
 * find expense" case, where no word you typed appears in the text.
 */
export type MatchKind = 'exact' | 'semantic';

export interface RankedResult {
  id: string;
  ref: string;
  text: string;
  score: number;
  matchKind: MatchKind;
  /** The sentence within `text` that answers the query, when the proxy's
   *  refine pass ran and picked one. Absent for keyword searches. */
  span?: string;
}

/** Popup -> background. */
export type BackgroundRequest = { type: 'SEARCH'; query: string } | { type: 'JUMP'; ref: string };

/** Background -> popup, in response to a BackgroundRequest. */
export type BackgroundResponse =
  { type: 'RESULTS'; results: RankedResult[] } | { type: 'ERROR'; error: string };

/** Background -> content script (tab). */
export type ContentRequest =
  | { type: 'EXTRACT' }
  /** `terms` are the query's meaningful words, so the content script can mark
   *  literal occurrences without re-deriving them from the raw query. */
  | { type: 'HIGHLIGHT'; results: RankedResult[]; terms: string[] }
  | { type: 'JUMP'; ref: string };

/** Content script -> background, in response to an EXTRACT request. */
export type ContentResponse =
  { type: 'CHUNKS'; chunks: Chunk[] } | { type: 'ERROR'; reason: 'TOO_MUCH_TEXT' | 'NO_CONTENT' };
