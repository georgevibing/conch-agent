import { useSyncExternalStore } from 'react';

/**
 * Voice choices belong to the device (ADR 0027): its microphone, its voices,
 * whether you're happy for its browser's speech service to hear you.
 */
export interface VoicePrefs {
  /** `auto`: on the device when it can, else private (on the computer), else the browser's service. */
  engine: 'auto' | 'private' | 'browser';
  /** A BCP-47 tag ("en-GB"); unset: the browser's language. */
  lang?: string;
  /** `voiceURI` of the voice that reads aloud; unset: the best one for the language. */
  voice?: string;
  rate: number;
  /** You said yes to the browser's speech service hearing you. */
  cloudOk: boolean;
}

const KEY = 'conch.voice';
const DEFAULTS: VoicePrefs = { engine: 'auto', rate: 1, cloudOk: false };
const listeners = new Set<() => void>();
let cached: VoicePrefs | undefined;

function read(): VoicePrefs {
  if (cached) return cached;
  try {
    cached = {
      ...DEFAULTS,
      ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VoicePrefs>),
    };
  } catch {
    cached = DEFAULTS;
  }
  return cached;
}

export function voicePrefs(): VoicePrefs {
  return read();
}

export function setVoicePrefs(patch: Partial<VoicePrefs>): void {
  cached = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Private windows: kept for this visit.
  }
  for (const l of listeners) l();
}

export function useVoicePrefs(): VoicePrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    read,
  );
}

export const languageOf = (prefs: VoicePrefs) => prefs.lang ?? navigator.language ?? 'en-US';
