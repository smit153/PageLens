/**
 * Literal term matching, used to tell an exact hit from a semantic one.
 *
 * Runs locally on text we already have, so it costs nothing and never needs
 * Jev: whether a passage literally contains "Sweden" is a string operation,
 * and the model's judgement is reserved for meaning.
 */

/** Words too common to signal anything about which passage you wanted. */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'did',
  'do',
  'does',
  'for',
  'from',
  'has',
  'have',
  'how',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
]);

const MIN_TERM_CHARS = 3;

/** Meaningful words from a query, lowercased, in the order typed. */
export function extractTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}$£€%-]+/u)) {
    const term = raw.replace(/^-+|-+$/g, '');
    if (term.length < MIN_TERM_CHARS) continue;
    if (STOPWORDS.has(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  return terms;
}

/**
 * Builds a word-boundary regex for the terms.
 *
 * `\b` is wrong here: it does not fire around characters like `$` or `-`, so a
 * term such as `cap-and-trade` would never match. Lookarounds on "letter or
 * digit" keep whole-word behaviour without that hole.
 */
export function termPattern(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/** True when the text literally contains one of the query's terms. */
export function hasExactMatch(text: string, terms: string[]): boolean {
  const pattern = termPattern(terms);
  if (!pattern) return false;
  return pattern.test(text);
}
