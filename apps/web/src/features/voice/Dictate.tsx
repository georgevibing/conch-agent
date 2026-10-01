import { toast, VoiceButton } from '@conch/nacre';
import { useEffect, useRef, useState } from 'react';

import { listen, type Listening } from './listen';
import { useListenEngine } from './useEngine';
import { VoiceGate } from './VoiceGate';

/**
 * Dictation in the composer (ADR 0027): press, speak, and the words appear
 * in the message as you say them; press again (or Escape) to stop. Nothing is
 * sent until you send it.
 */
export function Dictate({ draft, setDraft }: { draft: string; setDraft: (text: string) => void }) {
  const choice = useListenEngine();
  const [state, setState] = useState<'idle' | 'listening' | 'working'>('idle');
  const [level, setLevel] = useState(0);
  const [gate, setGate] = useState(false);
  const listening = useRef<Listening | undefined>(undefined);
  /** What was in the composer, plus everything settled since. */
  const base = useRef('');
  const draftNow = useRef(draft);
  useEffect(() => {
    draftNow.current = draft;
  }, [draft]);

  useEffect(() => () => listening.current?.cancel(), []);
  useEffect(() => {
    if (state !== 'listening') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') listening.current?.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  const start = async () => {
    if (!choice) return;
    if (choice.kind !== 'ready') return setGate(true);
    const before = draftNow.current;
    base.current = before && !/\s$/.test(before) ? `${before} ` : before;
    try {
      listening.current = await listen(choice.engine, choice.lang, {
        onInterim: (text) => setDraft(base.current + text),
        onFinal: (text) => {
          if (!text) return;
          base.current = `${base.current}${text} `;
          setDraft(base.current);
          if (choice.engine === 'private') setState('idle');
        },
        onLevel: setLevel,
        onEnd: () => {
          setState('idle');
          setLevel(0);
          setDraft(base.current.trimEnd() ? base.current : before);
        },
        onError: (message) => toast.error(message),
      });
      setState('listening');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Dictation didn’t start.');
    }
  };

  const stop = () => {
    // Private dictation writes it down once you stop; the browser's already has.
    if (choice?.kind === 'ready' && choice.engine === 'private') setState('working');
    listening.current?.stop();
  };

  if (choice?.kind === 'none') return null;
  return (
    <>
      <VoiceButton
        state={state}
        level={level}
        disabled={!choice}
        onClick={() =>
          state === 'listening' ? stop() : state === 'idle' ? void start() : undefined
        }
      />
      <VoiceGate
        choice={choice}
        open={gate}
        onOpenChange={setGate}
        onReady={() => setGate(false)}
      />
    </>
  );
}
