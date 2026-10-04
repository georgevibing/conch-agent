import { ListeningIndicator } from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useUi } from '../../app/ui';
import { voiceApi, voiceKeys } from './api';
import { setVoicePrefs, useVoicePrefs } from './prefs';
import { BurstCutter } from './wake';
import { encodeWav, toMono16k } from './wav';

const PHRASE = '“Hey Conch”';

/** "Hey Conch" can listen here now: turned on, in the desktop app, with private listening ready. */
export function useWakeListening(): boolean {
  const prefs = useVoicePrefs();
  // Asked only once it's turned on: everywhere else, nothing changes.
  const { data: status } = useQuery({
    queryKey: voiceKeys.status,
    queryFn: voiceApi.status,
    enabled: Boolean(prefs.wake),
    staleTime: 30_000,
  });
  return Boolean(prefs.wake && status?.wake?.available && status.private.state === 'ready');
}

/**
 * Listens for "Hey Conch" while it's on (ADR 0078), and says so in the
 * header the whole time, with Stop. It pauses while talk mode has the
 * microphone, and tells the tray what it's doing so the closed window still
 * shows it.
 */
export function WakeWord({ onChat }: { onChat: boolean }) {
  const listening = useWakeListening();
  const talking = useUi((s) => s.talking !== undefined);
  const navigate = useNavigate();
  const [hearing, setHearing] = useState(false);
  const onChatRef = useRef(onChat);
  useEffect(() => {
    onChatRef.current = onChat;
  });

  // The tray says what the window does, and forgets it if the window goes quiet.
  useEffect(() => {
    if (!listening) return;
    void voiceApi.wakeState(true).catch(() => undefined);
    const beat = setInterval(() => void voiceApi.wakeState(true).catch(() => undefined), 45_000);
    return () => {
      clearInterval(beat);
      void voiceApi.wakeState(false).catch(() => undefined);
    };
  }, [listening]);

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
          .wake(wav)
          .then((result) => {
            if (!result.heard || stopped) return;
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
  }, [listening, talking, navigate]);

  if (!listening) return null;
  return (
    <ListeningIndicator
      phrase={PHRASE}
      hearing={hearing}
      onStop={() => setVoicePrefs({ wake: false })}
    />
  );
}
