import { DATA_ATTR } from './extract';
import type { RankedResult } from '../types';

const HIGHLIGHT_TOP_CLASS = 'pagelens-highlight-top';
const STYLE_ID = 'pagelens-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_TOP_CLASS} {
      background-color: #ffd76a !important;
      outline: 2px solid #e08b00 !important;
      border-radius: 2px;
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
