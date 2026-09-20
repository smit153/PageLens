import { MAX_SCORE } from '../config';
import type { BackgroundRequest, BackgroundResponse, RankedResult } from '../types';

const form = document.querySelector<HTMLFormElement>('#search-form')!;
const input = document.querySelector<HTMLInputElement>('#query')!;
const stateEl = document.querySelector<HTMLDivElement>('#state')!;
const resultsEl = document.querySelector<HTMLOListElement>('#results')!;
const pageUrlEl = document.querySelector<HTMLSpanElement>('#page-url')!;
const shortcutEl = document.querySelector<HTMLElement>('#shortcut-badge')!;

const SNIPPET_LIMIT = 190;
/** Characters of lead-in kept when a snippet has to scroll to reach its span. */
const SPAN_CONTEXT = 40;

// Mirrors the manifest's `commands` binding: Command+Shift+F on mac, Ctrl+Shift+F elsewhere.
shortcutEl.textContent = navigator.userAgent.includes('Mac') ? '⌘⇧F' : '⌃⇧F';

void (async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  try {
    const url = new URL(tab.url);
    pageUrlEl.textContent = `${url.hostname.replace(/^www\./, '')}${url.pathname}`;
  } catch {
    // Non-standard URLs (chrome://, file://…) just keep the default label.
  }
})();

function showState(message: string, options: { spinner?: boolean; error?: boolean } = {}): void {
  resultsEl.replaceChildren();
  stateEl.replaceChildren();
  stateEl.classList.add('is-visible');
  stateEl.classList.toggle('is-error', options.error === true);

  if (options.spinner) {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    stateEl.appendChild(spinner);
  }

  const text = document.createElement('p');
  text.textContent = message;
  stateEl.appendChild(text);
}

function clearState(): void {
  stateEl.classList.remove('is-visible', 'is-error');
  stateEl.replaceChildren();
}

/**
 * Bolds query terms inside a snippet. Builds real text nodes rather than
 * assigning innerHTML -- this text comes straight off an arbitrary web page
 * and must never be parsed as markup.
 */
function highlightTerms(text: string, query: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2);

  if (terms.length === 0) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  const haystack = text.toLowerCase();
  let cursor = 0;

  while (cursor < text.length) {
    let bestStart = -1;
    let bestEnd = -1;

    for (const term of terms) {
      const found = haystack.indexOf(term, cursor);
      if (found !== -1 && (bestStart === -1 || found < bestStart)) {
        bestStart = found;
        bestEnd = found + term.length;
      }
    }

    if (bestStart === -1) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
      break;
    }

    if (bestStart > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, bestStart)));
    }
    const strong = document.createElement('strong');
    strong.textContent = text.slice(bestStart, bestEnd);
    fragment.appendChild(strong);
    cursor = bestEnd;
  }

  return fragment;
}

/**
 * Trims a passage to snippet length while keeping its answer span visible. A
 * span near the end of a long passage would otherwise be cut off entirely,
 * leaving the card showing everything except the part that answers the query.
 */
function buildSnippet(result: RankedResult): string {
  const { text, span } = result;
  if (text.length <= SNIPPET_LIMIT) return text;

  const spanStart = span ? text.indexOf(span) : -1;
  if (spanStart === -1 || spanStart + span!.length <= SNIPPET_LIMIT) {
    return `${text.slice(0, SNIPPET_LIMIT).trimEnd()}…`;
  }

  const start = Math.max(0, spanStart - SPAN_CONTEXT);
  const end = Math.min(text.length, start + SNIPPET_LIMIT);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Bolds the answer sentence within a snippet, text nodes only. */
function highlightSpan(text: string, span: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const start = text.indexOf(span);

  if (start === -1) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  if (start > 0) fragment.appendChild(document.createTextNode(text.slice(0, start)));
  const strong = document.createElement('strong');
  strong.textContent = span;
  fragment.appendChild(strong);
  const rest = text.slice(start + span.length);
  if (rest) fragment.appendChild(document.createTextNode(rest));

  return fragment;
}

function renderResults(results: RankedResult[], query: string): void {
  clearState();
  resultsEl.replaceChildren();

  for (const result of results) {
    const card = document.createElement('li');
    card.className = 'result-card';

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const score = document.createElement('span');
    score.className = 'match-score';
    score.textContent = `${Math.round((result.score / MAX_SCORE) * 100)}% MATCH`;

    const pill = document.createElement('span');
    pill.className = `pill pill-${result.matchKind}`;
    pill.textContent = result.matchKind === 'exact' ? 'Exact' : 'Semantic';
    pill.title =
      result.matchKind === 'exact'
        ? 'Contains the words you typed'
        : 'Matched on meaning, not wording';

    meta.append(score, pill);

    const snippet = document.createElement('p');
    snippet.className = 'snippet';
    const text = buildSnippet(result);
    // Bold the answer sentence when the refine pass found one -- it is chosen
    // on meaning, so it stays right for a query whose words never appear in
    // the passage. Keyword searches skip that pass, so they fall back to
    // literal term matching.
    snippet.appendChild(
      result.span ? highlightSpan(text, result.span) : highlightTerms(text, query),
    );

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'jump-btn';
    jump.textContent = 'Jump to passage ↗';
    jump.addEventListener('click', () => {
      const message: BackgroundRequest = { type: 'JUMP', ref: result.ref };
      chrome.runtime.sendMessage(message);
    });
    actions.appendChild(jump);

    card.append(meta, snippet, actions);
    resultsEl.appendChild(card);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  showState('Searching page…', { spinner: true });

  const message: BackgroundRequest = { type: 'SEARCH', query };
  chrome.runtime.sendMessage(message, (response: BackgroundResponse) => {
    if (chrome.runtime.lastError) {
      showState(chrome.runtime.lastError.message ?? 'Search failed.', { error: true });
      return;
    }
    if (response.type === 'ERROR') {
      showState(response.error, { error: true });
      return;
    }
    if (response.results.length === 0) {
      showState('Nothing on this page matched closely enough.');
      return;
    }
    renderResults(response.results, query);
  });
});
