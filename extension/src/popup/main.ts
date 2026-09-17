import type { BackgroundRequest, BackgroundResponse, RankedResult } from '../types';

const form = document.querySelector<HTMLFormElement>('#search-form')!;
const input = document.querySelector<HTMLInputElement>('#query')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const resultsEl = document.querySelector<HTMLOListElement>('#results')!;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function renderResults(results: RankedResult[]): void {
  resultsEl.innerHTML = '';

  for (const [index, result] of results.entries()) {
    const li = document.createElement('li');
    li.className = 'result';

    const rank = document.createElement('span');
    rank.className = 'result-rank';
    rank.textContent = `${index + 1}`;

    const snippet = document.createElement('button');
    snippet.type = 'button';
    snippet.className = 'result-snippet';
    snippet.textContent = result.text.length > 160 ? `${result.text.slice(0, 160)}…` : result.text;
    snippet.addEventListener('click', () => {
      const message: BackgroundRequest = { type: 'JUMP', ref: result.ref };
      chrome.runtime.sendMessage(message);
    });

    li.append(rank, snippet);
    resultsEl.appendChild(li);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  setStatus('Searching…');
  resultsEl.innerHTML = '';

  const message: BackgroundRequest = { type: 'SEARCH', query };
  chrome.runtime.sendMessage(message, (response: BackgroundResponse) => {
    if (chrome.runtime.lastError) {
      setStatus(`Error: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (response.type === 'ERROR') {
      setStatus(response.error);
      return;
    }
    if (response.results.length === 0) {
      setStatus('No relevant passages found.');
      return;
    }

    const count = response.results.length;
    setStatus(`Top ${count} result${count === 1 ? '' : 's'} — click one to jump to it:`);
    renderResults(response.results);
  });
});
