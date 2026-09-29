/**
 * The plain-model-API engines: one implementation, two providers.
 *
 * ```ts
 * new ApiEngine(openrouterVariant({ home: config.CONCH_HOME }), settings, keys)
 * new ApiEngine(anthropicApiVariant({ home: config.CONCH_HOME }), settings, keys)
 * ```
 */
export { ApiEngine } from './engine';
export { anthropicApiVariant } from './anthropic';
export { openrouterVariant } from './openrouter';
export type { ApiDeps, ApiProviderId, ApiVariant } from './types';
