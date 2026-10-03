import { TalkMode, type TalkState } from '@conch/nacre';
import { useEffect, useRef, useState } from 'react';

import { useUi } from '../../app/ui';
import {
  emptyView,
  pendingPermission,
  pendingQuestion,
  type ConversationView,
} from '../../live/reducer';
import { questionWords } from '../questions/words';
import { useLiveStore } from '../../live/store';
import { listen, type Listening } from './listen';
import { languageOf, useVoicePrefs } from './prefs';
import { createSpeaker, sentences, speakable, type Speaker } from './speak';
import { useListenEngine } from './useEngine';

/** What the assistant has said since `from` (the item count when you spoke). */
export function replySince(view: ConversationView, from: number): { text: string; done: boolean } {
  const said = view.items.slice(from).filter((i) => i.kind === 'assistant');
  const text = said.map((i) => (i.kind === 'assistant' ? i.text : '')).join('\n\n');
  return { text, done: view.status === 'idle' || view.status === 'error' };
}

/**
 * Talking, hands free (ADR 0027): listen → send → speak the answer as it
 * arrives, a sentence at a time → listen again. Everything happens in the
 * chat itself, so it's all there in writing afterwards.
 */
export function Talk({
  conversationId,
  send,
  name,
}: {
  conversationId?: string;
  send: (text: string) => void;
  name: string;
}) {
  const viewNow = () =>
    (conversationId ? useLiveStore.getState().views[conversationId] : undefined) ?? emptyView;
  const talking = useUi((s) => s.talking);
  const open = talking !== undefined;
  const onOpenChange = (o: boolean) => useUi.setState({ talking: o ? {} : undefined });
  const choice = useListenEngine();
  const prefs = useVoicePrefs();
  // Opened on a new chat's page while its answer is on the way: thinking until it speaks.
  const [state, setState] = useState<TalkState>(
    talking?.from !== undefined ? 'thinking' : 'listening',
  );
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [problem, setProblem] = useState<string>();
  const listening = useRef<Listening | undefined>(undefined);
  const speaker = useRef<Speaker | undefined>(undefined);
  /** Where the answer to what you just said starts, and how much of it has been spoken. */
  // Opened again on a new chat's own page: the answer to what was said is on its way here.
  const turn = useRef<{ from: number; spoken: number } | undefined>(
    talking?.from !== undefined ? { from: talking.from, spoken: 0 } : undefined,
  );
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** The question already read out, so it's said once. */
  const asked = useRef<string | undefined>(undefined);

  const stopAll = () => {
    listening.current?.cancel();
    listening.current = undefined;
    speaker.current?.stop();
    turn.current = undefined;
  };

  const startListening = async () => {
    if (!choice || choice.kind !== 'ready') {
      setState('error');
      setProblem(
        choice?.kind === 'none'
          ? choice.reason
          : 'Set up how Conch hears you in Settings → Voice first.',
      );
      return;
    }
    setProblem(undefined);
    setHeard('');
    setState('listening');
    try {
      let said = '';
      listening.current = await listen(choice.engine, choice.lang, {
        endOnSilence: true,
        onInterim: (text) => {
          setState('hearing');
          setHeard(`${said} ${text}`.trim());
        },
        onFinal: (text) => {
          said = `${said} ${text}`.trim();
          setHeard(said);
          // The browser's recognition ends on its own after a pause; private dictation once it's read.
          if (choice.engine === 'private') finish(said);
        },
        onLevel: setLevel,
        onEnd: () => {
          if (choice.engine !== 'private') finish(said);
        },
        onError: (message) => {
          setState('error');
          setProblem(message);
        },
      });
    } catch (error) {
      setState('error');
      setProblem(error instanceof Error ? error.message : 'The microphone didn’t start.');
    }
  };

  const finish = (said: string) => {
    listening.current = undefined;
    setLevel(0);
    if (!said.trim()) {
      // Nothing heard: keep listening, quietly.
      if (open) void startListening();
      return;
    }
    const from = viewNow().items.length;
    turn.current = { from, spoken: 0 };
    useUi.setState({ talking: { from } });
    setReply('');
    setState('thinking');
    send(said);
  };

  /** Say it, then listen again. */
  const say = (words: string, then: () => void) => {
    setState('speaking');
    speaker.current ??= createSpeaker({
      lang: languageOf(prefs),
      voice: prefs.voice,
      rate: prefs.rate,
    });
    const s = speaker.current;
    queue.current = queue.current.then(() => s.say(words));
    void queue.current.then(then);
  };

  // The answer, spoken a sentence at a time as it arrives.
  const follow = (view: ConversationView) => {
    const t = turn.current;
    if (!t) return;
    // A question with answers to tap (ADR 0060): read it out, and what's said back answers it.
    const question = view.status === 'awaiting-permission' ? pendingQuestion(view) : undefined;
    if (question && !pendingPermission(view)) {
      if (asked.current === question.id) return;
      asked.current = question.id;
      const { text } = replySince(view, t.from);
      const unsaid = sentences(speakable(text)).slice(t.spoken).join(' ');
      setReply(speakable(text));
      const mine = t;
      say([unsaid, questionWords(question.question)].filter(Boolean).join(' '), () => {
        if (turn.current !== mine) return;
        turn.current = undefined;
        useUi.setState({ talking: {} });
        void startListening();
      });
      return;
    }
    if (view.status === 'awaiting-permission') {
      setState('paused');
      setProblem(`${name} needs your OK for something. It’s on screen: type instead to answer.`);
      return;
    }
    const { text, done } = replySince(view, t.from);
    if (!text && !done) return;
    setReply(speakable(text));
    const all = sentences(speakable(text));
    // While it's still writing, the last sentence may not be finished: hold it back.
    const ready = done ? all : all.slice(0, -1);
    const fresh = ready.slice(t.spoken);
    if (fresh.length) {
      t.spoken = ready.length;
      setState('speaking');
      speaker.current ??= createSpeaker({
        lang: languageOf(prefs),
        voice: prefs.voice,
        rate: prefs.rate,
      });
      const s = speaker.current;
      queue.current = queue.current.then(() => s.say(fresh.join(' ')));
    }
    if (done) {
      const mine = t;
      void queue.current.then(() => {
        if (turn.current !== mine) return;
        turn.current = undefined;
        useUi.setState({ talking: {} });
        void startListening();
      });
    }
  };
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  });
  useEffect(() => {
    if (!open || !conversationId) return;
    let last: ConversationView | undefined;
    // What already arrived (a new chat's answer, before its page opened) counts too.
    queueMicrotask(() => {
      last = useLiveStore.getState().views[conversationId];
      if (last) followRef.current(last);
    });
    return useLiveStore.subscribe((s) => {
      const view = s.views[conversationId];
      if (!view || view === last) return;
      last = view;
      followRef.current(view);
    });
  }, [open, conversationId]);

  // A gentle pulse while it speaks, so the pearl talks too.
  useEffect(() => {
    if (state !== 'speaking') return;
    const t = setInterval(() => setLevel(0.25 + Math.abs(Math.sin(Date.now() / 180)) * 0.35), 90);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => {
    // Waiting for an answer already (a new chat's page): listen once it's spoken.
    if (open && !turn.current) void startListening();
    else if (!open) stopAll();
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- starts and ends with the overlay
  }, [open]);

  return (
    <TalkMode
      open={open}
      onOpenChange={(o) => {
        if (!o) stopAll();
        onOpenChange(o);
      }}
      state={state}
      level={level}
      heard={heard || undefined}
      reply={state === 'speaking' || state === 'thinking' ? reply || undefined : undefined}
      name={name}
      problem={problem}
      onPearl={() => {
        if (state === 'speaking') {
          speaker.current?.stop();
          turn.current = undefined;
          queue.current = Promise.resolve();
          void startListening();
        } else if (state === 'listening' || state === 'hearing') listening.current?.stop();
        else if (state === 'paused' || state === 'error') void startListening();
      }}
      onMute={() => {
        if (state === 'paused') void startListening();
        else {
          stopAll();
          setState('paused');
          setLevel(0);
        }
      }}
      onKeyboard={() => {
        stopAll();
        onOpenChange(false);
      }}
    />
  );
}
