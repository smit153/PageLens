/**
 * What kind of thing the user typed. Deliberately decided by inspecting the
 * string, not by asking Jev: whether a query is one word or a question is
 * syntax, and a model round trip to answer it would cost latency and money for
 * something a regex settles reliably. Jev's judgement is reserved for meaning.
 */
export type QueryShape = 'keyword' | 'phrase' | 'question';

const INTERROGATIVES =
  /^(who|what|when|where|why|how|which|is|are|was|were|do|does|did|can|could|should|would|will|has|have)\b/i;

export function detectQueryShape(query: string): QueryShape {
  const trimmed = query.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);

  if (words.length <= 1) return 'keyword';
  if (trimmed.endsWith('?') || INTERROGATIVES.test(trimmed)) return 'question';
  return 'phrase';
}

interface ShapePolicy {
  /** Minimum Jev score (0-3) a passage needs to be shown at all. */
  minScore: number;
  /** How many results to list. */
  topN: number;
  /** Whether to run the proxy's sentence-level second pass. */
  refine: boolean;
  /**
   * Whether literal query terms should be marked in the page.
   *
   * For a keyword or a phrase the words you typed *are* what you are looking
   * for. For a question they are not: "how do plants turn sunlight into food"
   * is asking for one sentence, and marking every "plants" and "sunlight" on a
   * photosynthesis article buries that answer in noise.
   */
  markTerms: boolean;
}

/**
 * A one-word topic lookup legitimately matches a lot of a page, so it casts a
 * wider net and settles for a block-level highlight. A full question should
 * have one specific answer, so it demands a higher score, shows fewer results,
 * and pays for the refine pass that pinpoints the sentence.
 */
export const SHAPE_POLICY: Record<QueryShape, ShapePolicy> = {
  keyword: { minScore: 1.2, topN: 10, refine: false, markTerms: true },
  phrase: { minScore: 1.5, topN: 8, refine: true, markTerms: true },
  question: { minScore: 1.8, topN: 5, refine: true, markTerms: false },
};

export type { ShapePolicy };

export function policyFor(query: string): ShapePolicy {
  return SHAPE_POLICY[detectQueryShape(query)];
}
