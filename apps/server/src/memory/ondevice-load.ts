/**
 * Running a model that's here (ADR 0041): transformers.js on ONNX Runtime,
 * from local files only. Used inside the model's own process
 * (`ondevice-runner.ts`), and by tests directly.
 */
import { sep } from 'node:path';

import type { OnDeviceSpec } from './ondevice';

/** Runs a model that's here: texts in, normalized vectors out. */
export interface Runner {
  embed(texts: string[]): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

export type LoadRunner = (dir: string, spec: OnDeviceSpec) => Promise<Runner>;

/** The real one: transformers.js on ONNX Runtime, from local files only. */
export const loadTransformers: LoadRunner = async (dir, spec) => {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = dir.endsWith(sep) ? dir : `${dir}${sep}`;
  env.useFSCache = false;
  env.useBrowserCache = false;
  // Belt and braces: the runtime never reaches the network.
  env.fetch = () => Promise.reject(new Error('Conch’s meaning model never downloads by itself.'));
  const extractor = await pipeline('feature-extraction', spec.repo, {
    dtype: 'q8',
    device: 'cpu',
    local_files_only: true,
    // A couple of cores: the chat keeps its computer.
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
  return {
    // One text at a time: padding in a batch nudges a quantized model's
    // vectors, and the same words should always give the same vector. It's
    // no slower for sentences this short.
    async embed(texts) {
      const out: Float32Array[] = [];
      for (const text of texts) {
        const tensor = await extractor(text, { pooling: 'mean', normalize: true });
        out.push(Float32Array.from(tensor.data as Float32Array));
      }
      return out;
    },
    dispose: () => extractor.dispose(),
  };
};
