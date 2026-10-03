import { Callout } from '@conch/nacre';
import type { ReactNode } from 'react';

import { AppsGallery } from './apps';
import { ChannelFacts, ChannelGrid, ChannelScene } from './channels';
import { DownloadApp } from './download';
import { InstallCommand } from './install';
import { ProviderFacts, ProviderGrid, ProviderMatrix, ServerFacts } from './providers';
import {
  CliReference,
  EffortList,
  EnvReference,
  FilesReference,
  ModeList,
  NeedsReference,
  PasswordManagers,
  RoutesReference,
  SlashReference,
  SocketReference,
} from './reference';
import { AccentPicker, DecisionList, HowItWorks, SectionCards } from './site';

type EmbedView = (props: { args: string[] }) => ReactNode;

/**
 * The generated parts a page can ask for with `<!-- conch:name -->`. Each one
 * draws what the code says today (`virtual:conch-reference`), so the page
 * around it only has to say what it's for.
 */
const EMBEDS: Record<string, EmbedView> = {
  accents: AccentPicker,
  apps: AppsGallery,
  channel: ({ args }) => <ChannelFacts id={args[0] ?? ''} />,
  'channel-scene': ({ args }) => <ChannelScene id={args[0] ?? ''} scene={args[1]} />,
  channels: ChannelGrid,
  cli: CliReference,
  decisions: DecisionList,
  download: DownloadApp,
  efforts: EffortList,
  env: EnvReference,
  files: FilesReference,
  how: HowItWorks,
  install: InstallCommand,
  modes: ModeList,
  needs: NeedsReference,
  'password-managers': PasswordManagers,
  provider: ({ args }) => <ProviderFacts id={args[0] ?? ''} />,
  'provider-matrix': ProviderMatrix,
  providers: ProviderGrid,
  routes: RoutesReference,
  'server-facts': ServerFacts,
  section: ({ args }) => <SectionCards id={args[0] ?? ''} />,
  slash: SlashReference,
  socket: ({ args }) => <SocketReference kind={args[0] ?? ''} />,
};

/** Every part a page may name; `content.test.ts` checks pages against it. */
export const EMBED_NAMES: readonly string[] = Object.keys(EMBEDS);

export function Embed({ name, args }: { name: string; args: string[] }) {
  const View = EMBEDS[name];
  if (!View)
    return (
      <Callout tone="danger" title={`There’s no “conch:${name}”`}>
        This page asks for a generated part that doesn’t exist. The ones that do are listed in
        apps/docs/src/embeds/Embed.tsx.
      </Callout>
    );
  return <View args={args} />;
}
