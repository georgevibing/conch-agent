/**
 * What a Conch app brings besides tools and pages (ADR 0122), as Nacre's
 * review card shows it: its provider or its chat app, from its manifest, and
 * the live test's answer in the card's words.
 */
import type { AppPartTest, ConchAppManifest } from '@conch/protocol';
import type { PartChannelView, PartProviderView, PartTestView } from '@conch/nacre';

export function bringsOf(
  manifest: ConchAppManifest,
): { provider?: PartProviderView; channel?: PartChannelView } | undefined {
  const { provider, channel } = manifest;
  if (!provider && !channel) return undefined;
  return {
    ...(provider && {
      provider: {
        name: provider.name ?? manifest.name,
        speaks: provider.speaks,
        models: provider.models,
        ...(provider.key && { key: provider.key }),
        reaches: manifest.reaches,
      },
    }),
    ...(channel && {
      channel: {
        name: channel.name ?? manifest.name,
        fields: channel.fields,
        steps: channel.steps,
        receives: channel.receives,
      },
    }),
  };
}

/** The gateway's word on a test, as the card shows it. */
export function testView(result: AppPartTest): PartTestView {
  return result.ok
    ? {
        state: 'passed',
        said: result.said,
        ms: result.ms,
        ...(result.model && { model: result.model }),
      }
    : { state: 'failed', message: result.message, ...(result.field && { field: result.field }) };
}
