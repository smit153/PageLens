/** Max sentences offered as choices for one passage. Beyond this the options
 *  stop being distinguishable and the token cost stops being worth it. */
const MAX_SENTENCES = 12;

/** A sentence shorter than this is a fragment -- a stray citation marker or a
 *  dangling abbreviation -- not a candidate answer. */
const MIN_SENTENCE_CHARS = 25;

/**
 * Splits a passage into candidate answer sentences.
 *
 * Uses Intl.Segmenter rather than a regex on `[.!?]`: it is built into both
 * Node and the Edge Runtime, and it gets the cases a regex fails on, notably
 * abbreviations ("e.g. $50") and trailing citation markers ("works[12].").
 */
export function splitSentences(text: string): string[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

  const sentences: string[] = [];
  for (const { segment } of segmenter.segment(text)) {
    const trimmed = segment.trim();
    if (trimmed.length >= MIN_SENTENCE_CHARS) sentences.push(trimmed);
    if (sentences.length === MAX_SENTENCES) break;
  }

  return sentences;
}
