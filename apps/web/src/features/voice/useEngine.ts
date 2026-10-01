import { useQuery } from '@tanstack/react-query';

import { voiceApi, voiceKeys } from './api';
import { deviceRecognition, recognitionClass, type ListenEngine } from './listen';
import { languageOf, useVoicePrefs } from './prefs';

export function useVoiceStatus() {
  return useQuery({
    queryKey: voiceKeys.status,
    queryFn: voiceApi.status,
    staleTime: 30_000,
    refetchInterval: (q) => (q.state.data?.private.state === 'downloading' ? 1000 : false),
  });
}

/**
 * Which way Conch hears you here, and what's needed first:
 * - `ready` with an engine;
 * - `consent`: only the browser's speech service is left, and you haven't said yes yet;
 * - `setup`: nothing works yet; private dictation can be set up;
 * - `none`: no microphone access at all here (not https).
 */
export type EngineChoice =
  | { kind: 'ready'; engine: ListenEngine; lang: string }
  | { kind: 'consent'; lang: string }
  | { kind: 'setup'; lang: string }
  | { kind: 'none'; reason: string };

export function useListenEngine(): EngineChoice | undefined {
  const prefs = useVoicePrefs();
  const lang = languageOf(prefs);
  const { data: voice } = useVoiceStatus();
  const device = useQuery({
    queryKey: ['voice', 'device', lang],
    queryFn: () => deviceRecognition(lang),
    staleTime: Infinity,
  });
  if (!window.isSecureContext || !navigator.mediaDevices)
    return {
      kind: 'none',
      reason:
        'The microphone needs Conch’s secure (https) address. Open Conch there to talk to it.',
    };
  if (!voice || device.isPending) return undefined;
  const privateReady = voice.private.state === 'ready';
  const browser = Boolean(recognitionClass());
  if (prefs.engine === 'private')
    return privateReady ? { kind: 'ready', engine: 'private', lang } : { kind: 'setup', lang };
  if (prefs.engine === 'browser')
    return browser
      ? prefs.cloudOk
        ? { kind: 'ready', engine: 'browser', lang }
        : { kind: 'consent', lang }
      : { kind: 'setup', lang };
  if (device.data !== 'no') return { kind: 'ready', engine: 'device', lang };
  if (privateReady) return { kind: 'ready', engine: 'private', lang };
  if (browser)
    return prefs.cloudOk ? { kind: 'ready', engine: 'browser', lang } : { kind: 'consent', lang };
  return { kind: 'setup', lang };
}
