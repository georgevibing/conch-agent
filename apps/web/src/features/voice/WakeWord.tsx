import { ListeningIndicator } from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';

import { useUi } from '../../app/ui';
import { inDesktopApp } from '../../lib/pick';
import { voiceApi, voiceKeys } from './api';
import { setVoicePrefs, useVoicePrefs } from './prefs';
import { BurstCutter, OPEN_IDLE_MS, wakePhrase } from './wake';
import { encodeWav, toMono16k } from './wav';

/**
 * Where "Hey Conch" listens on this device (ADR 0078, ADR 0108):
 * - `app`: the desktop app's window, even while it's closed, shown in the tray;
 * - `open`: any other device (a phone), only while Conch is open and on screen.
 */
export type WakeMode = 'app' | 'open';

/** Whether this device can listen at all, how, and for what phrase. */
export function useWake(enabled = true) {
  const { data: status } = useQuery({
    queryKey: voiceKeys.status,
    queryFn: voiceApi.status,
    enabled,
    staleTime: 30_000,
  });
  const mode: WakeMode = status?.wake?.available && inDesktopApp() ? 'app' : 'open';
  // Listening needs the microphone, which browsers give only to a secure page.
  const possible =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    Boolean(navigator.mediaDevices) &&
    'AudioContext' in window;
  return { status, mode, possible, phrase: wakePhrase(status?.wake?.name) };
}

/** "Hey Conch" can listen here now: turned on, with private listening ready. */
export function useWakeListening(): boolean {
  const prefs = useVoicePrefs();
  // Asked only once it's turned on: everywhere else, nothing changes.
  const { status, possible } = useWake(Boolean(prefs.wake));
  return Boolean(prefs.wake && possible && status?.private.state === 'ready');
}

const visibility = {
  subscribe: (change: () => void) => {
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  },
  get: () => document.visibilityState === 'visible',
};

/**
 * Listens for "Hey Conch" while it's on (ADR 0078), and says so in the
 * header the whole time, with Stop. It pauses while talk mode has the
 * microphone. In the desktop app it tells the tray what it's doing, so the
 * closed window still shows it. Anywhere else (a phone) it listens only
 * while Conch is on screen, keeps the screen awake while it does, and stops
 * by itself after five minutes without hearing it (ADR 0108).
 */
export function WakeWord({ onChat }: { onChat: boolean }) {
  const on = useWakeListening();
  const { mode, phrase } = useWake(on);
  const open = mode === 'open';
  const visible = useSyncExternalStore(visibility.subscribe, visibility.get, () => true);
  const talking = useUi((s) => s.talking !== undefined);
  const navigate = useNavigate();
  const [hearing, setHearing] = useState(false);
  /** Stopped by itself to spare the battery; one press listens again. */
  const [paused, setPaused] = useState(false);
  /** Bumped when it hears the phrase or listens again: five more minutes. */
  const [fresh, setFresh] = useState(0);
  const onChatRef = useRef(onChat);
  useEffect(() => {
    onChatRef.current = onChat;
  });
  // Coming back to Conch on a phone listens again, as it did when you left.
  useEffect(() => {
    if (!open) return;
    const left = () => {
      if (document.visibilityState === 'hidden') setPaused(false);
    };
    document.addEventListener('visibilitychange', left);
    return () => document.removeEventListener('visibilitychange', left);
  }, [open]);

  /** Listening right now: on, and (on a phone) on screen and not paused. */
  const listening = on && (!open || (visible && !paused));

  // The gateway reads bursts only from a device that says it's listening (and the tray says so).
  useEffect(() => {
    if (!listening) return;
    void voiceApi.wakeState(true, open).catch(() => undefined);
    const beat = setInterval(
      () => void voiceApi.wakeState(true, open).catch(() => undefined),
      45_000,
    );
    return () => {
      clearInterval(beat);
      void voiceApi.wakeState(false, open).catch(() => undefined);
    };
  }, [listening, open]);

  // On a phone: the screen stays on while it listens, and it stops after a while unheard.
  useEffect(() => {
    if (!listening || !open) return;
    let lock: WakeLockSentinel | undefined;
    let released = false;
    void navigator.wakeLock
      ?.request('screen')
      .then((sentinel) => {
        if (released) void sentinel.release().catch(() => undefined);
        else lock = sentinel;
      })
      .catch(() => undefined);
    const idle = setTimeout(() => setPaused(true), OPEN_IDLE_MS);
    return () => {
      released = true;
      clearTimeout(idle);
      void lock?.release().catch(() => undefined);
    };
  }, [listening, open, fresh]);

  useEffect(() => {
    if (!listening || talking || !navigator.mediaDevices || !('AudioContext' in window)) return;
    let stopped = false;
    let checking = false;
    let release: (() => void) | undefined;
    void (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (stopped) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      // Audio-thread callbacks keep coming while the window is hidden.
      const node = context.createScriptProcessor(4096, 1, 1);
      const cutter = new BurstCutter(context.sampleRate);
      node.onaudioprocess = (event) => {
        const burst = cutter.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        if (!burst || checking || stopped) return;
        checking = true;
        setHearing(true);
        const wav = encodeWav(toMono16k([burst], context.sampleRate));
        void voiceApi
          .wake(wav, open)
          .then((result) => {
            if (!result.heard || stopped) return;
            setFresh((n) => n + 1);
            if (!onChatRef.current) void navigate('/');
            useUi.setState({ talking: result.rest ? { first: result.rest } : {} });
          })
          .catch(() => undefined)
          .finally(() => {
            checking = false;
            setHearing(false);
          });
      };
      source.connect(node);
      // A processor only runs when connected onward; nothing is played.
      const silent = context.createGain();
      silent.gain.value = 0;
      node.connect(silent);
      silent.connect(context.destination);
      release = () => {
        node.onaudioprocess = null;
        for (const track of stream.getTracks()) track.stop();
        void context.close().catch(() => undefined);
      };
    })().catch(() => undefined);
    return () => {
      stopped = true;
      release?.();
    };
  }, [listening, talking, navigate, open]);

  if (!on || (open && !visible)) return null;
  return (
    <ListeningIndicator
      phrase={phrase}
      hearing={hearing}
      paused={paused}
      onResume={() => {
        setPaused(false);
        setFresh((n) => n + 1);
      }}
      onStop={() => setVoicePrefs({ wake: false })}
    />
  );
}
