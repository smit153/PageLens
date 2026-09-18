import type { BackgroundRequest, BackgroundResponse, RankedResult } from '../types';

const form = document.querySelector<HTMLFormElement>('#search-form')!;
const input = document.querySelector<HTMLInputElement>('#query')!;
const stateEl = document.querySelector<HTMLDivElement>('#state')!;
const resultsEl = document.querySelector<HTMLOListElement>('#results')!;
const pageUrlEl = document.querySelector<HTMLSpanElement>('#page-url')!;
const shortcutEl = document.querySelector<HTMLElement>('#shortcut-badge')!;

/** Jev scores against a 4-level rubric indexed from zero, so 3 is a perfect match. */
const MAX_SCORE = 3;
const SNIPPET_LIMIT = 190;

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

function renderResults(results: RankedResult[], query: string): void {
  clearState();
  resultsEl.replaceChildren();

  for (const result of results) {
    const card = document.createElement('li');
    card.className = 'result-card';

    const score = document.createElement('div');
    score.className = 'match-score';
    score.textContent = `${Math.round((result.score / MAX_SCORE) * 100)}% MATCH`;

    const snippet = document.createElement('p');
    snippet.className = 'snippet';
    const text =
      result.text.length > SNIPPET_LIMIT
        ? `${result.text.slice(0, SNIPPET_LIMIT).trimEnd()}…`
        : result.text;
    snippet.appendChild(highlightTerms(text, query));

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

    card.append(score, snippet, actions);
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
