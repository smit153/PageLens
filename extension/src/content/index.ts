import { MAX_PAGE_CHARS } from '../config';
import type { ContentRequest, ContentResponse } from '../types';
import { chunkBlocks } from './chunk';
import { extractVisibleBlocks } from './extract';
import { clearHighlights, highlightResults, jumpTo } from './highlight';

declare global {
  interface Window {
    __pageLensLoaded?: boolean;
  }
}

// The background worker re-injects this file on every search (see
// background/index.ts), so guard against double-registering the listener
// if Chrome runs it more than once in the same page lifetime.
if (!window.__pageLensLoaded) {
  window.__pageLensLoaded = true;

  chrome.runtime.onMessage.addListener(
    (message: ContentRequest, _sender, sendResponse: (response: ContentResponse) => void) => {
      if (message.type === 'EXTRACT') {
        clearHighlights();
        void (async () => {
          const blocks = extractVisibleBlocks();
          if (blocks.length === 0) {
            sendResponse({ type: 'ERROR', reason: 'NO_CONTENT' });
            return;
          }

          const chunks = await chunkBlocks(blocks);
          const chars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
          if (chunks.length === 0 || chars > MAX_PAGE_CHARS) {
            sendResponse({ type: 'ERROR', reason: 'TOO_MUCH_TEXT' });
            return;
          }

          sendResponse({ type: 'CHUNKS', chunks });
        })();
        return true; // keep the message channel open for the async response
      }

      if (message.type === 'HIGHLIGHT') {
        highlightResults(message.results, message.terms);
        return false;
      }

      if (message.type === 'JUMP') {
        jumpTo(message.ref);
        return false;
      }

      return false;
    },
  );
}
