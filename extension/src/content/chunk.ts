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

interface Piece {
  text: string;
  ref: string;
  isProse: boolean;
}

/**
 * Splits each DOM block's text into passage-sized chunks (only blocks longer
 * than CHUNK_SIZE get split at all), then caps the total at MAX_CHUNKS.
 *
 * Prose gets first claim on the budget, with list items filling whatever is
 * left: reference-heavy pages produce far more <li> than <p>, and sampling the
 * combined set evenly buried the actual article text under footnotes and
 * navbox links. Within each group we still sample evenly by document position
 * so we keep coverage of the whole page rather than just its opening.
 */
export async function chunkBlocks(blocks: RawBlock[]): Promise<Chunk[]> {
  const pieces: Piece[] = [];

  for (const block of blocks) {
    const parts =
      block.text.length > CHUNK_SIZE ? await splitter.splitText(block.text) : [block.text];

    for (const part of parts) {
      const text = part.trim();
      if (text.length < MIN_CHUNK_CHARS) continue;
      pieces.push({ text, ref: block.ref, isProse: block.isProse });
    }
  }

  const prose = downsampleEvenly(
    pieces.filter((piece) => piece.isProse),
    MAX_CHUNKS,
  );
  const lists = downsampleEvenly(
    pieces.filter((piece) => !piece.isProse),
    MAX_CHUNKS - prose.length,
  );

  return [...prose, ...lists].map((piece, index) => ({
    id: `c${index}`,
    text: piece.text,
    ref: piece.ref,
  }));
}
