import { platform } from 'node:os';
import { join } from 'node:path';

import type { LinkableKind } from '@conch/protocol';

import type { Heal } from '../lib/recover';
import { findJava, findSignalCli, javaHomeOf } from '../setup/known';
import type { Platform } from '../setup/needs';
import type { ChannelLinker } from './linked';
import { MockSignal } from './mock/signal';
import { MockWhatsApp } from './mock/whatsapp';
import { SignalLinker } from './signal';
import { SignalDaemon, signalCliSpawn } from './signal-cli';
import { WhatsAppLinker } from './whatsapp';
import { baileysConnect } from './whatsapp-baileys';
import { WhatsAppSessions } from './whatsapp-sessions';

/**
 * Everything WhatsApp and Signal need, made once per Conch (ADR 0043): where
 * WhatsApp's keys live, the signal-cli Conch runs, the linkers, and with the
 * mock engine the pretend apps instead of the real ones.
 */
export function linkedChannels(options: { home: string; mock: boolean; heal?: Heal }) {
  const sessions = new WhatsAppSessions(options.home, options.heal);
  const mockWhatsApp = options.mock ? new MockWhatsApp() : undefined;
  const mockSignal = options.mock ? new MockSignal() : undefined;
  const os = platform() as Platform;
  const signal = new SignalDaemon({
    dir: join(options.home, 'signal'),
    spawn:
      mockSignal?.spawn ??
      signalCliSpawn({
        signalCli: () => findSignalCli(os),
        java: () => findJava(),
        javaHome: javaHomeOf,
      }),
  });
  const whatsapp = { sessions, connect: mockWhatsApp?.connect ?? baileysConnect };
  return {
    whatsapp,
    signal,
    mockWhatsApp,
    mockSignal,
    linker: (kind: LinkableKind): ChannelLinker =>
      kind === 'whatsapp' ? new WhatsAppLinker(whatsapp) : new SignalLinker(signal),
    async start() {
      await mockWhatsApp?.start();
      await mockSignal?.start();
    },
    stop() {
      signal.stop();
      void sessions.flush().catch(() => undefined);
      void mockWhatsApp?.stop();
      void mockSignal?.stop();
    },
  };
}

export type LinkedChannels = ReturnType<typeof linkedChannels>;
