import type { CatalogAuth } from '@conch/protocol';

/**
 * Everything the documentation reads from the code, as one plain object.
 * `build.ts` fills it in from the server, the web app and the protocol; the
 * site gets it as `virtual:conch-reference` (`plugin.ts`). Nothing here is
 * written by hand, so it can't go stale.
 */

export interface ProviderRef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** `program`: something installed on this computer. `key`: a key you paste. */
  connect: 'program' | 'key';
  highlights: string[];
  limits: string[];
  experimental: boolean;
  color?: string;
  homepage?: string;
  key?: { label: string; placeholder: string; url?: string; canSignIn: boolean };
  /** What the engine itself declares it can do. */
  can: {
    /** Conch can ask you before each step. */
    asksFirst: boolean;
    /** Reads and writes files, and runs commands, on this computer. */
    files: boolean;
    /** Looks at pictures you attach. */
    images: boolean;
    /** Saves memories and drafts routines by itself. */
    hostTools: boolean;
    /** Answers with no internet. */
    offline: boolean;
    /** `itself`: it runs your apps' servers. `through Conch`: Conch hands it their tools. */
    apps: 'itself' | 'through Conch';
    /** The provider account's own connectors, when it has them. */
    account?: string;
  };
}

export interface ChannelRef {
  id: string;
  name: string;
  tagline: string;
  color?: string;
  minutes?: number;
  available: boolean;
}

export interface IntegrationRef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  /** Catalog auth, including Conch-owned Google and provider-owned account connections. */
  auth: CatalogAuth;
  color?: string;
  homepage?: string;
  featured: boolean;
  examples: string[];
  access: string[];
  /** Runs on this computer rather than on the service's servers. */
  local: boolean;
}

export interface CliRef {
  name: string;
  usage: string;
  summary: string;
  group: string;
  detail: string;
  subcommands: { usage: string; summary: string }[];
}

export interface EnvRef {
  name: string;
  about: string;
  /** The default, as you'd write it; absent when there is none. */
  default?: string;
  /** What happens when it's unset and there's no default to show. */
  unset?: string;
  /** The values it takes, when it's one of a few. */
  values?: string[];
  internal: boolean;
}

export interface ModeRef {
  value: string;
  label: string;
  description: string;
  tone: 'default' | 'caution' | 'danger';
}

export interface EffortRef {
  value: string;
  label: string;
  description: string;
}

export interface SlashRef {
  name: string;
  description: string;
  argumentHint?: string;
  aliases: string[];
}

export interface FileRef {
  /** Where, under the Conch folder. */
  path: string;
  /** `kept`, `secret`, `derived` or `outside` (see the backups guide). */
  class: 'kept' | 'secret' | 'derived' | 'outside';
  group?: string;
  why: string;
}

export interface NeedRef {
  id: string;
  name: string;
  /** Per platform: how Conch gets it. Absent when it doesn't exist there. */
  platforms: Partial<Record<'win32' | 'darwin' | 'linux', NeedHow>>;
  /** Conch keeps it up to date (Settings → Health → Updates). */
  updates: boolean;
  /** Another program that brings this one with it. */
  comesWith?: string;
}

export interface NeedHow {
  /** The command Conch runs when you press Install. */
  install?: string;
  /** Where to get it yourself. */
  download?: string;
}

export interface RouteRef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** The first folder of the path after `/api`, as a heading. */
  area: string;
}

export interface FieldRef {
  name: string;
  type: string;
  optional: boolean;
}

export interface MessageRef {
  type: string;
  fields: FieldRef[];
}

export interface Reference {
  version: string;
  protocolVersion: number;
  providers: ProviderRef[];
  channels: ChannelRef[];
  integrations: IntegrationRef[];
  cli: CliRef[];
  env: EnvRef[];
  modes: ModeRef[];
  efforts: EffortRef[];
  slash: SlashRef[];
  files: FileRef[];
  needs: NeedRef[];
  routes: RouteRef[];
  socket: {
    /** What the app sends. */
    commands: MessageRef[];
    /** What Conch sends. */
    events: MessageRef[];
    /** What a conversation's log is made of. */
    conversation: MessageRef[];
  };
  /** Every key combination the app listens for (`useHotkey`). */
  hotkeys: string[];
  /** Password managers Conch reads beside its own vault. */
  passwordManagers: string[];
}
