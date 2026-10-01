/**
 * Turning words into vectors, for memory search that finds what you meant
 * (ADR 0032). Two ways, both on this computer:
 *
 * - `meaning`: an embedding model in Ollama (nomic-embed-text and the like).
 *   "anniversary" finds "married on 12 June"; nothing leaves the computer.
 * - `words`: Conch's own, always there. Words and their spellings, hashed
 *   into a fixed-size vector (word stems plus letter trigrams), so a typo or
 *   another form of a word ("runs", "running") still matches. It doesn't know
 *   synonyms — that's what the model is for — and says so.
 */
import type { OllamaClient } from '../local/ollama';

export interface Embedder {
  /** What made the vectors: vectors from another embedder are never compared. */
  id: string;
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

const DIMS = 1024;

/** A light stemmer: enough that "meetings" meets "meeting" and "planned" meets "plan". */
export function stem(word: string): string {
  let w = word;
  for (const suffix of [
    'ingly',
    'edly',
    'ings',
    'ing',
    'ies',
    'ied',
    'ers',
    'er',
    'ed',
    'ly',
    'es',
    's',
  ]) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      if (suffix === 'ies' || suffix === 'ied') w += 'y';
      break;
    }
  }
  // "planned" → "plann" → "plan"
  if (/(.)\1$/.test(w) && w.length > 3) w = w.slice(0, -1);
  return w;
}

/** Words that carry no meaning of their own. */
const STOP = new Set(
  'a an and are as at be but by for from has have he her his i in is it its me my of on or our she that the their them they this to was we were with you your'.split(
    ' ',
  ),
);

export function tokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

function hash(text: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / n;
  return v;
}

/** Conch's own vectors: word stems and their letter trigrams, hashed. */
export function wordsVector(text: string): Float32Array {
  const v = new Float32Array(DIMS);
  for (const token of tokens(text)) {
    const h = hash(`w:${token}`);
    v[h % DIMS] = (v[h % DIMS] ?? 0) + (h & 1 ? 1 : -1) * 1;
    const padded = `#${token}#`;
    for (let i = 0; i + 3 <= padded.length; i++) {
      const g = hash(`g:${padded.slice(i, i + 3)}`);
      v[g % DIMS] = (v[g % DIMS] ?? 0) + (g & 1 ? 0.4 : -0.4);
    }
  }
  return normalize(v);
}

export const wordsEmbedder: Embedder = {
  id: 'words-v1',
  async embed(texts) {
    return texts.map(wordsVector);
  },
};

/** An embedding model in Ollama. Long texts are cut: a memory is a sentence or two. */
export function ollamaEmbedder(client: Pick<OllamaClient, 'embed'>, model: string): Embedder {
  return {
    id: `ollama:${model}`,
    async embed(texts, signal) {
      const out: Float32Array[] = [];
      // A few at a time: a thousand memories never become one giant request.
      for (let i = 0; i < texts.length; i += 32) {
        const batch = texts.slice(i, i + 32).map((t) => t.slice(0, 2000));
        const vectors = await client.embed(model, batch, signal);
        for (const vector of vectors) out.push(normalize(Float32Array.from(vector)));
      }
      return out;
    },
  };
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

/** Embedding models Conch knows, smallest good one first. */
export const MEANING_MODELS = [
  'nomic-embed-text',
  'embeddinggemma',
  'mxbai-embed-large',
  'snowflake-arctic-embed',
  'bge-m3',
  'all-minilm',
];
/** What Conch offers to get when Ollama is here and has none. */
export const OFFERED_MODEL = { model: 'nomic-embed-text', bytes: 274_000_000 };
