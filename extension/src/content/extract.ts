const CONTENT_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote';

// Beyond the obvious non-content landmarks, this skips citation and navigation
// containers. On reference-heavy pages (Wikipedia especially) they supply the
// overwhelming majority of <li> elements -- footnotes, bibliographies and
// navbox link soup -- which crowd real prose out of the chunk budget and score
// ~0 against any query.
const SKIP_ANCESTOR_SELECTOR = [
  'nav',
  'footer',
  'script',
  'style',
  'noscript',
  'aside',
  'form',
  '[role="navigation"]',
  '[role="contentinfo"]',
  '.reflist',
  '.references',
  '.navbox',
  '.infobox',
  '.mw-references-wrap',
  '.mw-editsection',
].join(', ');

export const DATA_ATTR = 'data-pagelens-id';

/** Prose carries far more searchable meaning than list items, so it wins the
 *  chunk budget when a page has more content than we can send. */
const PROSE_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

function isVisible(el: Element): boolean {
  if (el.closest(SKIP_ANCESTOR_SELECTOR)) return false;
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;

  if (typeof el.checkVisibility === 'function') {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  } else {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
  }

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export interface RawBlock {
  ref: string;
  text: string;
  /** True for paragraphs/headings/quotes, false for list items. */
  isProse: boolean;
}

/**
 * Walks the DOM for visible, text-bearing blocks (paragraphs, list items,
 * headings), skipping nav/footer/script/style. Tags each accepted element
 * with a data-pagelens-id attribute so we can scroll back to it later.
 */
export function extractVisibleBlocks(): RawBlock[] {
  document.querySelectorAll(`[${DATA_ATTR}]`).forEach((el) => el.removeAttribute(DATA_ATTR));

  const candidates = Array.from(document.querySelectorAll(CONTENT_SELECTOR));
  const blocks: RawBlock[] = [];
  const accepted: Element[] = [];

  let nextId = 0;
  for (const el of candidates) {
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
    if (!text) continue;
    // querySelectorAll returns nodes in document order, so any ancestor that
    // would contain `el` has already been visited (and accepted) by now.
    if (accepted.some((parent) => parent.contains(el))) continue;
    if (!isVisible(el)) continue;

    const ref = `pl-${nextId++}`;
    el.setAttribute(DATA_ATTR, ref);
    accepted.push(el);
    blocks.push({ ref, text, isProse: PROSE_TAGS.has(el.tagName) });
  }

  return blocks;
}
