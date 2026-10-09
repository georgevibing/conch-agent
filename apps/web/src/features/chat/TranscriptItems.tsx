import {
  ApprovalCard,
  ApprovalLine,
  Button,
  Callout,
  Collapsible,
  CopyButton,
  Diff,
  formatDuration,
  InlineCode,
  Message,
  SkillUsed,
  Stack,
  TaintReads,
  Text,
  ThinkingIndicator,
  WorkedFor,
  TurnMeter,
  ToolCall,
  toast,
  TurnCostTag,
  useSmoothText,
  type Speaker,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import type { MailEdit } from '@conch/protocol';
import { Brain, Undo2 } from 'lucide-react';
import { memo, createContext, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import type { TranscriptItem } from '../../live/reducer';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { SentAttachments } from './AttachmentViewer';
import { isMailApproval, rowState, withAnswer } from './approval';
import { MailApproval, mailOf } from './MailItems';
import { StreamingMarkdown } from './Markdown';
import { drawnAsFile, FileToolItem } from './FileToolItem';
import { drawnAsPicture, ImageToolItem } from './ImageToolItem';
import { formatInput, managedProcessSummary, toolDiff, toolSummary } from './tools';
import { ToolFound } from './ToolFound';
import { memoryApi } from '../memory/api';
import { HeldMemory } from '../memory/HeldMemory';
import styles from './Transcript.module.css';
import { useToolLabel } from '../integrations/ChatBits';
import { ReadAloud } from '../voice/ReadAloud';

type Of<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;

export function UserMessage({ item }: { item: Of<'user'> }) {
  const attachments = item.attachments ?? [];
  const message = (
    <Message
      from="user"
      data-anchor={item.id}
      timestamp={new Date(item.at)}
      data-pending={item.pending || undefined}
      className={styles.user}
      actions={
        item.text && !item.pending ? (
          <CopyButton value={item.text} label="Copy message" />
        ) : undefined
      }
    >
      <span className={styles.userText}>{item.text}</span>
    </Message>
  );
  if (!attachments.length) return message;
  return (
    <div className={styles.userWithAttachments} data-pending={item.pending || undefined}>
      <SentAttachments attachments={attachments} />
      {item.text ? message : <span data-anchor={item.id} />}
    </div>
  );
}

function thoughtFor(item: Of<'assistant'>): string {
  const end = item.textAt ?? item.thoughtEndedAt ?? item.endedAt;
  if (!end) return 'Thinking…';
  const s = Math.max(1, Math.round((end - item.startedAt) / 1000));
  return `Thought for ${s}s`;
}

/** A turn this long says, once it's over, what it took. */
const WORKED_FROM_MS = 20_000;

const ArrivedLive = createContext(false);

/** Whether the block this is in arrived live (see `Arrival`): only news moves. */
export const useArrivedLive = () => useContext(ArrivedLive);

/**
 * Wraps one transcript block. Whether it arrived live is decided once, when it
 * first appears, and never changes: blocks that were already there (history, a
 * reload) render at rest — no entrance, no reveal; only news animates.
 *
 * A `part` of a reply (a tool row, a card, more of its words) is a box of its
 * own that sits one step under what's above it, lined up with the reply's
 * words, wherever it is: in the transcript, or in the reply's own column.
 * One that renders nothing takes no room.
 */
export function Arrival({
  live,
  part,
  children,
}: {
  live: boolean;
  part?: boolean;
  children: ReactNode;
}) {
  const [arrivedLive] = useState(live);
  return (
    <ArrivedLive value={arrivedLive}>
      <div
        className={part ? `${styles.arrival} ${styles.part}` : styles.arrival}
        data-at-rest={arrivedLive ? undefined : ''}
      >
        {children}
      </div>
    </ArrivedLive>
  );
}

/** How the wait looks: the words it cycles through and when the turn began. */
export interface Wait {
  verbs: readonly string[];
  startedAt?: number;
  /** When this stretch began (the last step's end): its clock counts from here. */
  clockFrom?: number;
  /** What the reply has written so far this turn. */
  tokens?: number;
  srLabel: string;
}

export function Waiting({
  wait,
  trail,
  compact,
  orb = Boolean(compact),
}: {
  wait: Wait;
  trail?: string;
  compact?: boolean;
  /** The swirling pearl: off when the speaker's face beside it already moves. */
  orb?: boolean;
}) {
  return (
    <ThinkingIndicator
      verbs={wait.verbs}
      srLabel={wait.srLabel}
      startedAt={wait.startedAt}
      clockFrom={wait.clockFrom}
      tokens={wait.tokens}
      trail={trail}
      orb={orb}
      size={compact ? 'sm' : 'md'}
    />
  );
}

/** Stands in for the reply before anything arrives; the real one takes its place seamlessly. */
export function AssistantPlaceholder({
  speaker,
  wait,
  continued,
}: {
  speaker: Speaker;
  wait: Wait;
  /** The same voice as just before: no speaker line, so the wait wears its own pearl. */
  continued?: boolean;
}) {
  return (
    <Message
      from="assistant"
      speaker={speaker}
      continued={continued}
      status="streaming"
      timestamp={wait.startedAt === undefined ? undefined : new Date(wait.startedAt)}
      since={wait.startedAt}
    >
      <Waiting wait={wait} orb={continued} />
    </Message>
  );
}

/**
 * The words of a reply: the wait until the first whole word is ready, what
 * it thought (folded), and the words themselves, revealed as they arrive.
 * A reply's first words sit right under its speaker line; words after a
 * step (`part`) are a part of the reply, like its tool rows.
 */
export function AssistantWords({
  item,
  wait,
  part = item.continuation,
  faceless,
}: {
  item: Of<'assistant'>;
  /** Present while the turn runs: shown in place of the words until the first arrive. */
  wait?: Wait;
  part?: boolean;
  /** No speaker line moves above these words: the wait wears its own pearl. */
  faceless?: boolean;
}) {
  const streaming = !item.done;
  const arrivedLive = useContext(ArrivedLive);
  // Only a reply being written right now is revealed; history (e.g. after a reload) just shows.
  const smooth = useSmoothText(item.text, { streaming: streaming && arrivedLive });
  if (!item.text && !item.thinking) return null;
  // Keep the wait up until the first whole word is ready to show.
  const pondering = streaming && !smooth.text && wait !== undefined;
  const thought = item.thinking && !pondering && (
    <Collapsible className={styles.thoughtWrap}>
      <Collapsible.Trigger className={styles.thought}>{thoughtFor(item)}</Collapsible.Trigger>
      <Collapsible.Content>
        <Text size="sm" tone="muted" className={styles.thinking}>
          {item.thinking}
        </Text>
      </Collapsible.Content>
    </Collapsible>
  );
  const reply = smooth.text && <StreamingMarkdown text={item.text} smooth={smooth} />;
  if (part) {
    return (
      <div
        className={styles.continuation}
        data-anchor={item.messageId}
        data-streaming={streaming || undefined}
      >
        {pondering && <Waiting wait={wait} trail={item.thinking} compact />}
        {!item.text && thought}
        {reply}
      </div>
    );
  }
  return (
    <Stack gap={2}>
      {pondering && <Waiting wait={wait} trail={item.thinking} orb={faceless} />}
      {thought}
      {reply}
    </Stack>
  );
}

/**
 * One reply: who is speaking, its first words (`item`, when it began with
 * words rather than a step), everything that belongs to it, then its
 * actions. Each turn of the assistant is one of these, so its speaker line
 * comes once, at the top, whatever the turn did first.
 */
export function AssistantMessage({
  item,
  speaker,
  continued,
  at,
  meta,
  wait,
  working,
  entrance = true,
  attached,
  said,
  ended,
  steps,
  movedOn,
}: {
  /** The words it began with; left out when it began with a step (a tool, a card). */
  item?: Of<'assistant'>;
  speaker: Speaker;
  /** The same voice as the turn before, with nothing between: no second speaker line. */
  continued?: boolean;
  /** When it began, for the speaker line. */
  at: number;
  /** The model that answered, for the speaker line. */
  meta?: string;
  /** Present while the turn runs: shown in place of the words until the first arrive. */
  wait?: Wait;
  /** Still at work on this reply (a step running, more to come): the face moves. */
  working?: boolean;
  entrance?: boolean;
  /** The rest of the reply (tool rows, more words, its cards), drawn before its actions. */
  attached?: ReactNode;
  /**
   * The whole reply's words, once it's over: what Copy and Read aloud take.
   * Undefined while any of it is still being written (no actions yet).
   */
  said?: string;
  /** How its turn ended: what it cost sits among its actions (ADR 0079). */
  ended?: Of<'turn-end'>;
  /** How many steps its turn showed (ADR 0103): said with how long it took. */
  steps?: number;
  /**
   * Something came after its first words (a step): the wait is said there, by
   * the running story or the wait after it, never twice.
   */
  movedOn?: boolean;
}) {
  const streaming = item ? !item.done : false;
  return (
    <Message
      from="assistant"
      data-anchor={item?.messageId}
      speaker={speaker}
      continued={continued}
      meta={meta}
      timestamp={new Date(at)}
      status={streaming ? 'streaming' : 'complete'}
      working={working || streaming}
      entrance={entrance}
      // The turn's clock, shared with the placeholder this takes over from.
      since={wait?.startedAt ?? at}
      attached={attached}
      actions={
        said && !streaming ? (
          <>
            <ReadAloud text={said} />
            <CopyButton value={said} label="Copy reply" />
            {ended?.cost && <TurnCostTag cost={ended.cost} tokens={ended.usage} />}
            {/* A long turn says what it took, once: the live clock counted each stretch. */}
            {ended?.ranMs !== undefined &&
              ended.ranMs >= WORKED_FROM_MS &&
              (steps ? (
                <TurnMeter
                  running={false}
                  durationMs={ended.ranMs}
                  steps={steps}
                  tokens={ended.usage?.outputTokens}
                />
              ) : (
                <WorkedFor ms={ended.ranMs} tokens={ended.usage?.outputTokens} />
              ))}
          </>
        ) : undefined
      }
    >
      {item && (
        <AssistantWords
          item={item}
          wait={movedOn ? undefined : wait}
          part={false}
          faceless={continued}
        />
      )}
    </Message>
  );
}

/** Memoised: a finished tool's row doesn't redo its label and diff as the reply streams. */
export const ToolItem = memo(function ToolItem({
  item: call,
  asked,
}: {
  item: Of<'tool'>;
  /** The question about this call, if it asked: its answer shows on the row. */
  asked?: Of<'permission'>;
}) {
  const item = withAnswer(call, asked);
  // A picture being made is drawn as the picture, not as a row (ADR 0060).
  if (drawnAsPicture(item))
    return <ImageToolItem item={item} asking={Boolean(asked && !asked.decision)} />;
  // So is a file being made or offered: drawn as its file.
  if (drawnAsFile(item))
    return <FileToolItem item={item} asking={Boolean(asked && !asked.decision)} />;
  return <ToolRow item={item} asking={Boolean(asked && !asked.decision)} />;
});

function ToolRow({ item, asking = false }: { item: Of<'tool'>; asking?: boolean }) {
  const label = useToolLabel()(item.name, {
    running: item.status === 'running' || item.status === 'pending',
    input: item.input,
    view: item.view,
  });
  const diff = toolDiff(item.name, item.input);
  const row = rowState(item, asking);
  return (
    <ToolCall
      data-anchor={item.id}
      name={label ? label.title : item.name}
      leading={label?.leading}
      summary={
        managedProcessSummary(item.name, item.output) ??
        label?.summary ??
        toolSummary(item.name, item.input)
      }
      status={row.status}
      outcome={row.outcome}
      note={row.note}
      duration={item.durationMs}
      input={diff ? undefined : formatInput(item.input)}
      inputLanguage="json"
      output={item.output || undefined}
      view={item.view && <ToolFound view={item.view} />}
    >
      {diff && <Diff diff={diff} header={false} lineNumbers={false} />}
    </ToolCall>
  );
}

/** Render `backticked` spans of a summary as inline code. */
function withCode(text: string) {
  return text
    .split(/(`[^`]+`)/g)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') ? (
        <InlineCode key={i}>{part.slice(1, -1)}</InlineCode>
      ) : (
        part
      ),
    );
}

/** What the card's title says: its own short one, or the summary as a sentence. */
function approvalTitle(item: Of<'permission'>): string {
  const text = item.title ?? item.summary;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function PermissionCard({
  item,
  name,
  onRespond,
  allowAlways = true,
  call,
}: {
  item: Of<'permission'>;
  name: string;
  onRespond: (decision: 'allow' | 'allow-always' | 'deny', edit?: MailEdit) => void;
  /** Bounded workflows approve this action only, never a lasting permission. */
  allowAlways?: boolean;
  /** The call it's about: an email's card follows it while it goes. */
  call?: Of<'tool'>;
}) {
  // An email is asked about as the letter itself (ADR 0099).
  const mail = isMailApproval(item.toolName) ? mailOf(item.input) : undefined;
  if (mail) return <MailApproval item={item} call={call} mail={mail} onRespond={onRespond} />;
  return <AskCard item={item} name={name} onRespond={onRespond} allowAlways={allowAlways} />;
}

function AskCard({
  item,
  name,
  onRespond,
  allowAlways,
}: {
  item: Of<'permission'>;
  name: string;
  onRespond: (decision: 'allow' | 'allow-always' | 'deny') => void;
  allowAlways: boolean;
}) {
  const [sent, setSent] = useState<'allow' | 'allow-always' | 'deny'>();
  const allowRef = useAutoFocus<HTMLButtonElement>();
  const title = approvalTitle(item);
  // Answered with no row of its own to carry it: one quiet line (a row says it itself).
  if (item.decision) return <ApprovalLine decision={item.decision}>{withCode(title)}</ApprovalLine>;
  const respond = (decision: 'allow' | 'allow-always' | 'deny') => {
    setSent(decision);
    onRespond(decision);
  };
  const command =
    item.toolName === 'Bash' && typeof (item.input as { command?: unknown })?.command === 'string'
      ? (item.input as { command: string }).command
      : undefined;
  return (
    <ApprovalCard
      aria-label={`${name} asks first: ${title}`}
      title={withCode(title)}
      detail={item.detail}
      cost={item.cost}
      caution={item.caution ?? item.taint}
      // Asked because of what it read or for leaving the sealed box, "always" lets this
      // tool through for the rest of the chat; for a skill's list, or words going to
      // other people, it's this once.
      allowAlways={(!item.taint || Boolean(item.lasting)) && !item.once && allowAlways}
      sent={sent}
      onDecide={respond}
      allowRef={allowRef}
    >
      {command && <pre className={styles.permissionCommand}>{command}</pre>}
    </ApprovalCard>
  );
}

/** The chat read something from outside (ADR 0028): said once, quietly, however much it was. */
export function TaintItems({
  items,
  first,
  taskChat,
}: {
  items: Of<'taint'>[];
  first: boolean;
  /** This chat is a task's: what was carried came from the chat it was sent from. */
  taskChat: boolean;
}) {
  const carried = items[0]?.carried;
  return (
    <TaintReads
      reads={items.map((item) => item.source)}
      first={first}
      {...(carried && { from: taskChat ? 'chat' : 'task' })}
    />
  );
}

export function MemoryPill({ item }: { item: Of<'memory'> }) {
  // Anything not remembered yet is the memory check asking (ADR 0087, ADR 0097):
  // one card, saying why. Nothing routine ever waits here.
  if (item.action === 'saved' && (item.held || item.pending))
    return (
      <HeldMemory
        memoryId={item.memoryId}
        content={item.content}
        held={
          item.held ?? {
            verdict: 'ask',
            reasons: [{ code: 'outside', words: 'Conch wasn’t sure about this one.' }],
          }
        }
        {...(item.decided && { decided: item.decided })}
      />
    );
  return <MemoryLine item={item} />;
}

function MemoryLine({ item }: { item: Of<'memory'> }) {
  const client = useQueryClient();
  const [pressed, setPressed] = useState<'undone' | 'kept'>();
  // What you pressed shows at once (and goes back if it didn't work); after a
  // reload, the chat's own log says what you chose.
  const answer = pressed ?? item.decided;
  const act = async (keep: boolean) => {
    const before = pressed;
    setPressed(keep ? 'kept' : 'undone');
    try {
      if (keep && item.action === 'forgotten' && item.memory)
        await memoryApi.restore(item.memoryId);
      else if (keep) await memoryApi.keep(item.memoryId, { seen: item.content });
      else await api.deleteMemory(item.memoryId);
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      setPressed(before);
      toast.error((e as Error).message);
    }
  };
  // One it forgot, that you put back: remembered again.
  const putBack = item.action === 'forgotten' && answer === 'kept';
  const label = putBack
    ? 'Put back'
    : answer === 'undone' || item.action === 'forgotten'
      ? 'Forgot'
      : 'Remembered';
  return (
    <div
      className={styles.memory}
      data-action={answer === 'undone' ? 'undone' : putBack ? 'saved' : item.action}
    >
      <Brain aria-hidden />
      <span className={styles.memoryText}>
        <span className={styles.memoryLabel}>{label}</span> {item.content}
      </span>
      {item.action === 'forgotten'
        ? // It forgot something: Undo puts it back, exactly as it was.
          item.memory &&
          !putBack && (
            <Button
              variant="ghost"
              tone="neutral"
              size="sm"
              leadingIcon={<Undo2 />}
              onClick={() => void act(true)}
            >
              Undo
            </Button>
          )
        : answer !== 'undone' && (
            <Button
              variant="ghost"
              tone="neutral"
              size="sm"
              leadingIcon={<Undo2 />}
              onClick={() => void act(false)}
            >
              Undo
            </Button>
          )}
    </div>
  );
}

/** Which skill shaped this reply, or came with the work; opens the skill. */
export function SkillUsedLine({
  item,
  carriedFrom,
}: {
  item: Of<'skill'>;
  carriedFrom?: 'chat' | 'helper';
}) {
  const navigate = useNavigate();
  return (
    <div className={styles.skillUsed}>
      <SkillUsed
        name={item.name}
        title={item.title}
        by={item.by}
        carriedFrom={carriedFrom}
        onOpen={() => void navigate(`/skills/${encodeURIComponent(item.skillId)}`)}
      />
    </div>
  );
}

/** What the chat can do about a failed turn (built by the chat, which knows the providers). */
export interface TurnRecovery {
  /** The provider that failed, by name. */
  label: string;
  /** Sign in to it; the message goes again by itself once it's back. */
  signIn?: () => void;
  /** Signed in is what we're waiting for: the message goes again by itself. */
  waiting?: boolean;
  /** Another provider that's ready: answer with it instead, for now. */
  alternative?: { label: string; use: () => void };
  /** Open 1Password so it can be unlocked. */
  openOnePassword?: () => void;
  /** A ready model that reads more at once, for a chat too long for this one (ADR 0055). */
  bigger?: { label: string; use: () => void };
  /** Carry on in a new chat, the message waiting in its box. */
  newChat?: () => void;
}

const problemTitle = (problem: NonNullable<Of<'turn-end'>['problem']>, label: string) =>
  ({
    'signed-out': `${label} signed you out`,
    unavailable: `${label} isn’t answering right now`,
    limit: `You’ve reached your ${label} limit for now`,
    'key-locked': '1Password is locked',
    'too-long': `This chat is more than ${label} can read at once`,
  })[problem];

export function TurnEnd({
  item,
  onRetry,
  recover,
  onCarryOn,
}: {
  item: Of<'turn-end'>;
  onRetry?: () => void;
  recover?: TurnRecovery;
  /** The latest turn paused to check in (ADR 0085): send “Carry on”. */
  onCarryOn?: () => void;
}) {
  if (item.outcome === 'success' && item.paused) {
    // Once the chat has moved on, a pause is a quiet note in its history.
    if (!onCarryOn)
      return (
        <div className={styles.stopped}>
          <span className={styles.stoppedLine}>{item.paused.message}</span>
        </div>
      );
    return (
      <Callout
        tone="neutral"
        live="polite"
        action={
          <Button size="sm" onClick={onCarryOn}>
            Carry on
          </Button>
        }
      >
        {item.paused.message}
      </Callout>
    );
  }
  if (item.outcome === 'interrupted' && item.restarted) {
    // A few words on the mark; what to do about it on a line of its own, so the
    // mark stays short enough for a phone's column.
    const { resumed } = item.restarted;
    return (
      <div className={styles.stoppedNote}>
        <div className={styles.stopped}>
          <span className={styles.stoppedMark}>
            <span aria-hidden className={styles.stoppedGlyph} />
            <span className={styles.stoppedText}>
              {resumed ? 'Picked up after Conch restarted' : 'Stopped when Conch restarted'}
            </span>
          </span>
        </div>
        {!resumed && (
          // Why it didn't carry on by itself, when Conch knows (an action to check first).
          <p className={styles.stoppedWhy}>{item.error ?? 'Say “carry on” to pick it up again.'}</p>
        )}
      </div>
    );
  }
  if (item.outcome === 'interrupted') {
    // Where the reply ended because you said so: a quiet mark across the column.
    const after = item.usage?.durationMs;
    return (
      <div className={styles.stopped}>
        <span className={styles.stoppedMark}>
          <span aria-hidden className={styles.stoppedGlyph} />
          <span className={styles.stoppedText}>Stopped</span>
          {after ? (
            <span className={styles.stoppedAfter}>after {formatDuration(after)}</span>
          ) : null}
        </span>
        {/* What it had spent by then, quietly (ADR 0079). */}
        {item.cost && <TurnCostTag cost={item.cost} tokens={item.usage} />}
      </div>
    );
  }
  // An earlier failure the chat has moved past: a quiet line, not an alarm.
  if (item.outcome === 'error' && item.problem && !onRetry) {
    return <div className={styles.quietEnd}>Didn’t go through: {item.error}</div>;
  }
  if (item.outcome === 'error' && item.problem && recover && onRetry) {
    const { problem } = item;
    const retry = (
      <Button size="sm" variant="ghost" onClick={onRetry}>
        Try again
      </Button>
    );
    const other = recover.alternative && (
      <Button size="sm" variant="surface" onClick={recover.alternative.use}>
        Answer with {recover.alternative.label} for now
      </Button>
    );
    const primary =
      problem === 'signed-out' && recover.signIn ? (
        <Button size="sm" onClick={recover.signIn} loading={recover.waiting}>
          Sign in to {recover.label}
        </Button>
      ) : problem === 'key-locked' && recover.openOnePassword ? (
        <Button size="sm" onClick={recover.openOnePassword}>
          Open 1Password
        </Button>
      ) : problem === 'too-long' && recover.bigger ? (
        <Button size="sm" onClick={recover.bigger.use}>
          Use {recover.bigger.label}
        </Button>
      ) : problem === 'too-long' && recover.newChat ? (
        <Button size="sm" onClick={recover.newChat}>
          Start a new chat
        </Button>
      ) : undefined;
    return (
      <Callout
        tone={
          problem === 'signed-out' || problem === 'key-locked' || problem === 'too-long'
            ? 'warning'
            : 'danger'
        }
        title={problemTitle(problem, recover.label)}
      >
        <Stack gap={3}>
          <span>
            {recover.waiting
              ? 'Sign in, and your message goes again by itself.'
              : (item.error ?? 'Something went wrong while working on that.')}
          </span>
          <Stack direction="row" gap={2} wrap align="center">
            {primary}
            {/* Another provider's model isn't the answer to a long chat: a bigger window is. */}
            {problem !== 'too-long' && other}
            {retry}
          </Stack>
        </Stack>
      </Callout>
    );
  }
  if (item.outcome === 'error') {
    return (
      <Callout
        tone="danger"
        title="That didn’t work"
        action={
          onRetry && (
            <Button size="sm" variant="surface" onClick={onRetry}>
              Try again
            </Button>
          )
        }
      >
        {item.error ?? 'Something went wrong while working on that.'}
      </Callout>
    );
  }
  return null;
}
