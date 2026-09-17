export interface Chunk {
  id: string;
  text: string;
  /** Value of the data-pagelens-id attribute on the source DOM element. */
  ref: string;
}

export interface RankedResult {
  id: string;
  ref: string;
  text: string;
  score: number;
}

/** Popup -> background. */
export type BackgroundRequest = { type: 'SEARCH'; query: string } | { type: 'JUMP'; ref: string };

/** Background -> popup, in response to a BackgroundRequest. */
export type BackgroundResponse =
  { type: 'RESULTS'; results: RankedResult[] } | { type: 'ERROR'; error: string };

/** Background -> content script (tab). */
export type ContentRequest =
  | { type: 'EXTRACT' }
  | { type: 'HIGHLIGHT'; results: RankedResult[] }
  | { type: 'JUMP'; ref: string };

/** Content script -> background, in response to an EXTRACT request. */
export type ContentResponse =
  { type: 'CHUNKS'; chunks: Chunk[] } | { type: 'ERROR'; reason: 'TOO_MUCH_TEXT' | 'NO_CONTENT' };
