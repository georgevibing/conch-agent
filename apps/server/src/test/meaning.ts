import type { Embedder } from '../memory/embed';

/**
 * A pretend model that knows two meanings: travel ("honeymoon", "Bali",
 * "trip") and cooking. Everything else is a third, so it's never close.
 */
export function fakeEmbedder(id = 'fake:v1'): Embedder & { texts: string[] } {
  const texts: string[] = [];
  return {
    id,
    source: 'built-in',
    label: 'pretend',
    floor: 0.6,
    same: 0.9,
    texts,
    async embed(batch) {
      texts.push(...batch);
      return batch.map((text) => {
        const trip = /honeymoon|\bbali\b|\btrip\b/i.test(text) ? 1 : 0;
        const cook = /recipe|lasagne|\bcook/i.test(text) ? 1 : 0;
        return Float32Array.from([trip, cook, trip || cook ? 0.1 : 1]);
      });
    },
  };
}
