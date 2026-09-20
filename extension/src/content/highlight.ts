import { DATA_ATTR } from './extract';
import { termPattern } from '../lexical';
import type { RankedResult } from '../types';

const MARK_EXACT = 'pagelens-mark-exact';
const MARK_SEMANTIC = 'pagelens-mark-semantic';
const BLOCK_SOFT_CLASS = 'pagelens-block-soft';
const STYLE_ID = 'pagelens-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Two colours for two kinds of hit: amber for a literal term, matching the
  // find-in-page convention people already know, and the extension's purple
  // for a passage Jev matched on meaning alone.
  //
  // The descendant rules matter as much as the mark rules. A highlighted run
  // often contains links and other coloured inline text, and the page's own
  // palette (Wikipedia's blue links, say) is unreadable on either background.
  style.textContent = `
    mark.${MARK_EXACT},
    mark.${MARK_SEMANTIC} {
      border-radius: 2px;
      padding: 0 1px;
      scroll-margin: 120px;
    }
    mark.${MARK_EXACT},
    mark.${MARK_EXACT} * {
      background-color: #f0b429 !important;
      color: #1a1a1a !important;
      -webkit-text-fill-color: #1a1a1a !important;
    }
    mark.${MARK_SEMANTIC},
    mark.${MARK_SEMANTIC} * {
      background-color: #423a6a !important;
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
    }
    mark.${MARK_EXACT} *,
    mark.${MARK_SEMANTIC} * {
      background-color: transparent !important;
    }
    mark.${MARK_EXACT} a,
    mark.${MARK_SEMANTIC} a {
      text-decoration: underline !important;
      text-underline-offset: 2px;
    }
    /* Only used when neither a literal term nor an answer sentence could be
       located inside the block -- then framing the block is all we can do. */
    .${BLOCK_SOFT_CLASS} {
      outline: 2px solid #b3a6ec !important;
      outline-offset: 2px;
      border-radius: 3px;
      background-color: rgba(66, 58, 106, 0.14) !important;
      scroll-margin: 120px;
    }
  `;
  document.head.appendChild(style);
}

/** Unwraps our marks and restores the page's original text nodes. */
export function clearHighlights(): void {
  document.querySelectorAll(`mark.${MARK_EXACT}, mark.${MARK_SEMANTIC}`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });

  document
    .querySelectorAll(`.${BLOCK_SOFT_CLASS}`)
    .forEach((el) => el.classList.remove(BLOCK_SOFT_CLASS));
}

function elementForRef(ref: string): Element | null {
  return document.querySelector(`[${DATA_ATTR}="${CSS.escape(ref)}"]`);
}

function textNodesIn(root: Node): Text[] {
  if (root.nodeType === Node.TEXT_NODE) return [root as Text];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

function wrap(node: Text, start: number, end: number, className: string): boolean {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const mark = document.createElement('mark');
  mark.className = className;
  try {
    // Safe because the range never leaves this one text node, which is the
    // case surroundContents is guaranteed to handle.
    range.surroundContents(mark);
    return true;
  } catch {
    return false;
  }
}

/** Wraps every literal occurrence of the query's terms. Returns how many. */
function markTerms(root: Element, terms: string[]): number {
  const pattern = termPattern(terms);
  if (!pattern) return 0;

  let marked = 0;
  for (const node of textNodesIn(root)) {
    pattern.lastIndex = 0;
    const matches = [...node.data.matchAll(pattern)];
    // Wrapping splits the text node, so work backwards and earlier offsets
    // stay valid.
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const match = matches[i];
      if (match?.index === undefined) continue;
      if (wrap(node, match.index, match.index + match[0].length, MARK_EXACT)) marked += 1;
    }
  }
  return marked;
}

/**
 * Locates a sentence inside an element and returns a Range over it.
 *
 * Chunk text was whitespace-collapsed at extraction time, so a span never
 * matches the raw DOM text directly. This rebuilds the element's text in both
 * forms, keeping an index map between them, finds the span in collapsed space,
 * then maps the hit back to the original text nodes and offsets.
 */
function rangeForText(root: Element, needle: string): Range | null {
  const nodes = textNodesIn(root);
  if (nodes.length === 0) return null;

  const raw = nodes.map((node) => node.data).join('');
  let collapsed = '';
  const collapsedToRaw: number[] = [];
  let inWhitespace = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (/\s/.test(char)) {
      if (!inWhitespace && collapsed.length > 0) {
        collapsed += ' ';
        collapsedToRaw.push(i);
      }
      inWhitespace = true;
    } else {
      collapsed += char;
      collapsedToRaw.push(i);
      inWhitespace = false;
    }
  }

  const target = needle.trim().replace(/\s+/g, ' ');
  const at = collapsed.indexOf(target);
  if (at === -1) return null;

  const rawStart = collapsedToRaw[at];
  const rawEnd = collapsedToRaw[at + target.length - 1];
  if (rawStart === undefined || rawEnd === undefined) return null;

  const locate = (rawIndex: number): { node: Text; offset: number } => {
    let consumed = 0;
    for (const node of nodes) {
      if (rawIndex < consumed + node.data.length) {
        return { node, offset: rawIndex - consumed };
      }
      consumed += node.data.length;
    }
    const last = nodes[nodes.length - 1]!;
    return { node: last, offset: last.data.length };
  };

  const start = locate(rawStart);
  const end = locate(rawEnd);

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/** Wraps a range that may span several text nodes, one mark per node. */
function markRange(range: Range, className: string): number {
  const segments: Array<{ node: Text; start: number; end: number }> = [];

  for (const node of textNodesIn(range.commonAncestorContainer)) {
    if (!range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    if (end > start) segments.push({ node, start, end });
  }

  let marked = 0;
  // Backwards again: wrapping one segment splits its node.
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i]!;
    if (wrap(segment.node, segment.start, segment.end, className)) marked += 1;
  }
  return marked;
}

function scrollTo(el: Element): void {
  const mark = el.querySelector(`mark.${MARK_EXACT}, mark.${MARK_SEMANTIC}`);
  (mark ?? el).scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function jumpTo(ref: string): void {
  const el = elementForRef(ref);
  if (el) scrollTo(el);
}

/**
 * Highlights every result on the page, not just the best one, so a passage
 * listed in the popup is never sitting unmarked in plain view.
 *
 * Each result is marked as precisely as it can be: the literal terms for an
 * exact hit, the answer sentence for a semantic one, and only if neither can
 * be located does it fall back to framing the whole block.
 */
export function highlightResults(results: RankedResult[], terms: string[]): void {
  ensureStyles();
  clearHighlights();

  for (const result of results) {
    const el = elementForRef(result.ref);
    if (!el) continue;

    let marked = result.matchKind === 'exact' ? markTerms(el, terms) : 0;

    if (marked === 0 && result.span) {
      const range = rangeForText(el, result.span);
      if (range) marked = markRange(range, MARK_SEMANTIC);
    }

    if (marked === 0) el.classList.add(BLOCK_SOFT_CLASS);
  }

  const top = results[0];
  if (!top) return;
  const topEl = elementForRef(top.ref);
  if (topEl) scrollTo(topEl);
}
