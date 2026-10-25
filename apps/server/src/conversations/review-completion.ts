/** Bounded tool-less review, including model acquisition and providers ignoring cancellation. */
import type { Completion, CompletionInput } from '../engines/types';
import type { LookModel } from '../memory/guard';

export async function completeReview(
  model: () => Promise<LookModel | undefined>,
  input: Omit<CompletionInput, 'signal' | 'model'>,
  options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<Completion | undefined> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? 8_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  if (signal.aborted) return undefined;
  let onAbort: (() => void) | undefined;
  try {
    const work = async () => {
      const found = await model();
      if (!found || signal.aborted) return undefined;
      const answer = await found.complete({
        ...input,
        ...(found.model && { model: found.model }),
        signal,
      });
      return signal.aborted ? undefined : answer;
    };
    return await Promise.race([
      work(),
      new Promise<undefined>((resolve) => {
        onAbort = () => resolve(undefined);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Flat reviewer contracts must not accept keys JSON.parse would silently overwrite. */
export function reviewJson(text: string): unknown {
  if (text.length > 4_096) return undefined;
  try {
    const keys = [...text.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(
      (m) => JSON.parse(m[1] ?? '""') as string,
    );
    if (new Set(keys).size !== keys.length) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
