import type { EngineId, ModelCatalog, ModelInfo } from '@conch/protocol';

/**
 * For a chat too long for its model (ADR 0055): the ready model that reads the
 * most at once, if it reads clearly more than this one (half as much again),
 * can use the apps, and — between two the same — is the same provider's.
 */
export function biggerWindow(
  catalog: ModelCatalog | undefined,
  engine: EngineId | undefined,
  model: string | undefined,
): { engine: EngineId; model: ModelInfo } | undefined {
  const ready = (catalog?.providers ?? []).filter((p) => p.models.length > 0 && !p.message);
  const now =
    ready.find((p) => p.engine === engine)?.models.find((m) => m.id === model)?.context ?? 0;
  let best: { engine: EngineId; model: ModelInfo } | undefined;
  for (const provider of ready)
    for (const candidate of provider.models) {
      const size = candidate.context ?? 0;
      if (size < Math.max(now * 1.5, 1) || candidate.tools === false) continue;
      const bestSize = best?.model.context ?? 0;
      const sameEngine = provider.engine === engine;
      if (!best || size > bestSize || (size === bestSize && sameEngine && best.engine !== engine))
        best = { engine: provider.engine, model: candidate };
    }
  return best;
}
