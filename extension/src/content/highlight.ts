import { DATA_ATTR } from './extract';
import type { RankedResult } from '../types';

const HIGHLIGHT_TOP_CLASS = 'pagelens-highlight-top';
const STYLE_ID = 'pagelens-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // The descendant rules matter as much as the block rule: a highlighted
  // passage usually contains links and other coloured inline text, and a page's
  // own palette (Wikipedia's blue links, say) is unreadable against our
  // background. Forcing every descendant to transparent/white keeps the whole
  // passage legible no matter what the host page styles it. #423a6a against
  // white is ~10:1 contrast, so it stays accessible on light and dark pages.
  style.textContent = `
    .${HIGHLIGHT_TOP_CLASS} {
      background-color: #423a6a !important;
      outline: 2px solid #b3a6ec !important;
      outline-offset: 2px;
      border-radius: 3px;
      box-shadow: 0 0 0 6px rgba(66, 58, 106, 0.28) !important;
      scroll-margin: 96px;
    }
    .${HIGHLIGHT_TOP_CLASS},
    .${HIGHLIGHT_TOP_CLASS} * {
      color: #ffffff !important;
      -webkit-text-fill-color: #ffffff !important;
    }
    .${HIGHLIGHT_TOP_CLASS} * {
      background-color: transparent !important;
    }
    .${HIGHLIGHT_TOP_CLASS} a {
      text-decoration: underline !important;
      text-underline-offset: 2px;
    }
  `;
  document.head.appendChild(style);
}

export function clearHighlights(): void {
  document
    .querySelectorAll(`.${HIGHLIGHT_TOP_CLASS}`)
    .forEach((el) => el.classList.remove(HIGHLIGHT_TOP_CLASS));
}

function elementForRef(ref: string): Element | null {
  return document.querySelector(`[${DATA_ATTR}="${CSS.escape(ref)}"]`);
}

export function jumpTo(ref: string): void {
  const el = elementForRef(ref);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Highlights only the #1 result and auto-scrolls to it. Ranks 2-N stay
 * unhighlighted on the page and are reached via click-to-jump from the
 * popup's result list.
 */
export function highlightTopResult(results: RankedResult[]): void {
  ensureStyles();
  clearHighlights();

  const top = results[0];
  if (!top) return;

  const el = elementForRef(top.ref);
  if (el) el.classList.add(HIGHLIGHT_TOP_CLASS);
  jumpTo(top.ref);
}
