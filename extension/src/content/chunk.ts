import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { CHUNK_OVERLAP, CHUNK_SIZE, MAX_CHUNKS, MIN_CHUNK_CHARS } from '../config';
import type { Chunk } from '../types';
import type { RawBlock } from './extract';

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
  separators: ['\n\n', '\n', '. ', '! ', '? ', ' ', ''],
});

/** Picks `max` evenly-spaced items so we keep coverage across the whole page. */
function downsampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const item = items[Math.floor(i * step)];
    if (item !== undefined) out.push(item);
  }
  return out;
}

/**
 * Splits each DOM block's text into passage-sized chunks (only blocks longer
 * than CHUNK_SIZE get split at all), then caps the total at MAX_CHUNKS by
 * sampling evenly across the page rather than truncating the tail.
 */
export async function chunkBlocks(blocks: RawBlock[]): Promise<Chunk[]> {
  const pieces: Chunk[] = [];
  let nextId = 0;

  for (const block of blocks) {
    const parts =
      block.text.length > CHUNK_SIZE ? await splitter.splitText(block.text) : [block.text];

    for (const part of parts) {
      const text = part.trim();
      if (text.length < MIN_CHUNK_CHARS) continue;
      pieces.push({ id: `c${nextId++}`, text, ref: block.ref });
    }
  }

  return downsampleEvenly(pieces, MAX_CHUNKS);
}
