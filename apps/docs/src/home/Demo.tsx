import {
  Badge,
  IntegrationLogo,
  Message,
  RoutedNote,
  StreamingText,
  Surface,
  Text,
  ThinkingIndicator,
  ToolCall,
  usePrefersReducedMotion,
} from '@conch/nacre';
import { useEffect, useRef, useState } from 'react';
import reference from 'virtual:conch-reference';

import styles from './Demo.module.css';

/** A short conversation, as times (ms) on one clock: everything shown is worked out from `now`. */
const SCRIPT = {
  ask: 500,
  think: 1_300,
  tool: 2_900,
  toolDone: 4_300,
  answer: 4_700,
  answerDone: 7_900,
  askAgain: 9_300,
  routed: 10_300,
  thinkAgain: 10_500,
  answerAgain: 11_900,
  answerAgainDone: 14_600,
  end: 19_000,
} as const;

const ANSWER =
  'Twelve commits since Monday. The terminal landed, search got two fixes, and backups have a new format.';
const ANSWER_AGAIN =
  'Yes. I’m answering from the model on this computer now, and I still have the whole thread.';

/** How much of a reply has arrived at `now`, at an even pace. */
function arrived(text: string, now: number, from: number, to: number): string {
  if (now >= to) return text;
  return text.slice(0, Math.max(0, Math.round(((now - from) / (to - from)) * text.length)));
}

const provider = (id: string) => reference.providers.find((p) => p.id === id);

function Speaker({ id }: { id: string }) {
  const speaker = provider(id);
  if (!speaker) return null;
  return (
    <span key={id} className={styles.speaker}>
      <IntegrationLogo
        brand={speaker.id}
        name={speaker.name}
        color={speaker.color}
        size="xs"
        decorative
      />
      <Text as="span" size="sm" weight="medium">
        {speaker.name}
      </Text>
    </span>
  );
}

/**
 * Conch at work, in miniature: a question answered with a tool, then the same
 * chat carried on by the model on this computer. Made of the app's own chat
 * components and played on a loop; with reduced motion it shows how it ends.
 */
export function Demo() {
  const still = usePrefersReducedMotion();
  const [now, setNow] = useState(0);
  const started = useRef(0);

  useEffect(() => {
    if (still) return;
    let frame = 0;
    const tick = (time: number) => {
      // A hidden tab stops the clock rather than racing ahead.
      started.current ||= time;
      const elapsed = time - started.current;
      if (elapsed > SCRIPT.end) started.current = time;
      // A new picture about twelve times a second is plenty for words arriving.
      setNow((prev) => {
        const next = elapsed > SCRIPT.end ? 0 : elapsed;
        return Math.abs(next - prev) > 80 || next === 0 ? next : prev;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [still]);

  const at = still ? SCRIPT.end : now;
  const speaker = at >= SCRIPT.routed ? 'ollama' : 'claude-code';
  const working =
    (at >= SCRIPT.think && at < SCRIPT.answerDone) ||
    (at >= SCRIPT.thinkAgain && at < SCRIPT.answerAgainDone);

  return (
    <figure
      className={styles.figure}
      aria-label="Conch answering a question with Claude Code, then carrying on with the model on this computer"
    >
      <Surface
        elevation={3}
        radius="2xl"
        lustre={working ? 'ambient' : true}
        className={styles.window}
        // A picture of a chat, not a chat: nothing in it can be focused or is read out.
        inert
        aria-hidden
      >
        <div className={styles.titleBar}>
          <Speaker id={speaker} />
          <Badge size="sm" tone={working ? 'accent' : 'neutral'} dot={working ? 'pulse' : true}>
            {working ? 'Working' : 'Ready'}
          </Badge>
        </div>
        <div className={styles.chat}>
          {at >= SCRIPT.ask && (
            <Message from="user">What changed in this repo since Monday?</Message>
          )}
          {at >= SCRIPT.think && (
            <Message
              from="assistant"
              author="Conch"
              status={at < SCRIPT.answerDone ? 'streaming' : 'complete'}
            >
              <div className={styles.reply}>
                {at < SCRIPT.tool && <ThinkingIndicator size="sm" label="Reading the history" />}
                {at >= SCRIPT.tool && (
                  <ToolCall
                    name="Bash"
                    summary="git log --since=monday --oneline"
                    status={at < SCRIPT.toolDone ? 'running' : 'success'}
                    duration={1_400}
                  />
                )}
                {at >= SCRIPT.answer && (
                  <StreamingText
                    as="p"
                    text={arrived(ANSWER, at, SCRIPT.answer, SCRIPT.answerDone)}
                    streaming={at < SCRIPT.answerDone}
                  />
                )}
              </div>
            </Message>
          )}
          {at >= SCRIPT.askAgain && (
            <Message from="user">I’m about to board. Can you keep going offline?</Message>
          )}
          {at >= SCRIPT.routed && (
            <RoutedNote reason="offline">
              You’re offline, so {provider('ollama')?.name ?? 'the model on this computer'}{' '}
              answered.
            </RoutedNote>
          )}
          {at >= SCRIPT.thinkAgain && (
            <Message
              from="assistant"
              author="Conch"
              status={at < SCRIPT.answerAgainDone ? 'streaming' : 'complete'}
            >
              <div className={styles.reply}>
                {at < SCRIPT.answerAgain && (
                  <ThinkingIndicator size="sm" label="Picking up the thread" />
                )}
                {at >= SCRIPT.answerAgain && (
                  <StreamingText
                    as="p"
                    text={arrived(ANSWER_AGAIN, at, SCRIPT.answerAgain, SCRIPT.answerAgainDone)}
                    streaming={at < SCRIPT.answerAgainDone}
                  />
                )}
              </div>
            </Message>
          )}
        </div>
      </Surface>
    </figure>
  );
}
