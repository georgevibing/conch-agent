import {
  Button,
  Callout,
  Collapsible,
  CopyButton,
  Diff,
  DraftReview,
  GuardNote,
  InlineCode,
  Message,
  SkillUsed,
  Stack,
  Surface,
  TaintNotice,
  Text,
  ThinkingIndicator,
  ToolCall,
  toast,
  TurnCostTag,
  useSmoothText,
  type ToolCallStatus,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Brain, Check, ShieldQuestion, Undo2, X } from 'lucide-react';
import { memo, createContext, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { keys } from '../../api/queries';
import type { TranscriptItem } from '../../live/reducer';
import { useAutoFocus } from '../../lib/useAutoFocus';
import { SentAttachments } from './AttachmentViewer';
import { StreamingMarkdown } from './Markdown';
import { formatInput, toolDiff, toolSummary } from './tools';
import { ToolFound } from './ToolFound';
import { memoryApi } from '../memory/api';
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

const ArrivedLive = createContext(false);

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
  srLabel: string;
}

export function Waiting({
  wait,
  trail,
  compact,
}: {
  wait: Wait;
  trail?: string;
  compact?: boolean;
}) {
  return (
    <ThinkingIndicator
      verbs={wait.verbs}
      srLabel={wait.srLabel}
      startedAt={wait.startedAt}
      trail={trail}
      orb={Boolean(compact)}
      size={compact ? 'sm' : 'md'}
    />
  );
}

/** Stands in for the reply before anything arrives; the real one takes its place seamlessly. */
export function AssistantPlaceholder({ name, wait }: { name: string; wait: Wait }) {
  return (
    <Message
      from="assistant"
      author={name}
      status="streaming"
      timestamp={wait.startedAt === undefined ? undefined : new Date(wait.startedAt)}
      since={wait.startedAt}
    >
      <Waiting wait={wait} />
    </Message>
  );
}

export function AssistantMessage({
  item,
  name,
  wait,
  entrance = true,
  attached,
  said,
  ended,
}: {
  item: Of<'assistant'>;
  name: string;
  /** Present while the turn runs: shown in place of the reply until its first words arrive. */
  wait?: Wait;
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
  if (item.continuation) {
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
    <Message
      from="assistant"
      data-anchor={item.messageId}
      author={name}
      timestamp={new Date(item.startedAt)}
      status={streaming ? 'streaming' : 'complete'}
      entrance={entrance}
      // The turn's clock, shared with the placeholder this takes over from.
      since={wait?.startedAt ?? item.startedAt}
      attached={attached}
      actions={
        item.done && said ? (
          <>
            <ReadAloud text={said} />
            <CopyButton value={said} label="Copy reply" />
            {ended?.cost && <TurnCostTag cost={ended.cost} tokens={ended.usage} />}
          </>
        ) : undefined
      }
    >
      <Stack gap={2}>
        {pondering && <Waiting wait={wait} trail={item.thinking} />}
        {thought}
        {reply}
      </Stack>
    </Message>
  );
}

const toolStatus: Record<Of<'tool'>['status'], ToolCallStatus> = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  error: 'error',
};

/** Memoised: a finished tool's row doesn't redo its label and diff as the reply streams. */
export const ToolItem = memo(function ToolItem({ item }: { item: Of<'tool'> }) {
  const label = useToolLabel()(item.name, {
    running: item.status === 'running' || item.status === 'pending',
    input: item.input,
    view: item.view,
  });
  const diff = toolDiff(item.name, item.input);
  const stopped = item.status === 'error' && item.output === 'Stopped.';
  return (
    <ToolCall
      data-anchor={item.id}
      name={label ? label.title : item.name}
      leading={label?.leading}
      summary={label?.summary ?? toolSummary(item.name, item.input)}
      status={stopped ? 'cancelled' : toolStatus[item.status]}
      duration={item.durationMs}
      input={diff ? undefined : formatInput(item.input)}
      inputLanguage="json"
      output={item.output || undefined}
      view={item.view && <ToolFound view={item.view} />}
    >
      {diff && <Diff diff={diff} header={false} lineNumbers={false} />}
    </ToolCall>
  );
});

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

export function PermissionCard({
  item,
  name,
  onRespond,
  allowAlways = true,
}: {
  item: Of<'permission'>;
  name: string;
  onRespond: (decision: 'allow' | 'allow-always' | 'deny') => void;
  /** Bounded workflows approve this action only, never a lasting permission. */
  allowAlways?: boolean;
}) {
  const [sent, setSent] = useState<string>();
  const allowRef = useAutoFocus<HTMLButtonElement>();
  if (item.decision) {
    const allowed = item.decision === 'allow' || item.decision === 'allow-always';
    return (
      <div className={styles.resolved} data-allowed={allowed || undefined}>
        {allowed ? <Check aria-hidden /> : <X aria-hidden />}
        <span>
          {item.decision === 'expired'
            ? 'Request expired'
            : allowed
              ? item.decision === 'allow-always'
                ? 'Always allowed'
                : 'Allowed'
              : 'Declined'}
          {' · '}
          {withCode(item.summary)}
        </span>
      </div>
    );
  }
  const respond = (decision: 'allow' | 'allow-always' | 'deny') => {
    setSent(decision);
    onRespond(decision);
  };
  const command =
    item.toolName === 'Bash' && typeof (item.input as { command?: unknown })?.command === 'string'
      ? (item.input as { command: string }).command
      : undefined;
  const draftInput =
    item.input && typeof item.input === 'object' ? (item.input as Record<string, unknown>) : {};
  const draft =
    item.toolName.replace(/^mcp__conch__/, '') === 'google_mail_create_draft' &&
    typeof draftInput.body === 'string' &&
    typeof draftInput.subject === 'string' &&
    Array.isArray(draftInput.to) &&
    draftInput.to.every((to) => typeof to === 'string')
      ? {
          to: draftInput.to as string[],
          subject: draftInput.subject,
          body: draftInput.body,
          account:
            typeof draftInput.accountEmail === 'string' ? draftInput.accountEmail : undefined,
        }
      : undefined;
  return (
    <Surface
      lustre
      elevation={1}
      radius="lg"
      className={styles.permission}
      role="group"
      aria-label="Permission request"
    >
      <div className={styles.permissionHead}>
        <span className={styles.permissionIcon} aria-hidden>
          <ShieldQuestion />
        </span>
        <Stack gap={0.5}>
          <Text size="sm" weight="semibold">
            {name} would like to{' '}
            {withCode(item.summary.charAt(0).toLowerCase() + item.summary.slice(1))}
          </Text>
          <Text size="xs" tone="muted">
            Nothing happens until you decide.
          </Text>
        </Stack>
      </div>
      {item.taint && <GuardNote>{item.taint}</GuardNote>}
      {command && <pre className={styles.permissionCommand}>{command}</pre>}
      {draft && <DraftReview {...draft} />}
      <div className={styles.permissionActions}>
        <Button variant="ghost" onClick={() => respond('deny')} disabled={Boolean(sent)}>
          {draft ? 'Don’t save' : 'Deny'}
        </Button>
        {/* Asked because of what it read: this once, never always (ADR 0028). */}
        {!item.taint && allowAlways && !draft && (
          <Button
            variant="surface"
            onClick={() => respond('allow-always')}
            disabled={Boolean(sent)}
            loading={sent === 'allow-always'}
          >
            Always allow
          </Button>
        )}
        <Button
          ref={allowRef}
          onClick={() => respond('allow')}
          disabled={Boolean(sent)}
          loading={sent === 'allow'}
        >
          {draft ? 'Save draft' : 'Allow'}
        </Button>
      </div>
    </Surface>
  );
}

const READ_WORDS: Record<Of<'taint'>['source']['kind'], string> = {
  web: '',
  download: 'something downloaded from ',
  app: 'things in ',
  person: 'a message from ',
};

/** The chat read something from outside (ADR 0028): said once, quietly. */
export function TaintItem({ item, first }: { item: Of<'taint'>; first: boolean }) {
  const { kind, label } = item.source;
  const read =
    kind === 'download' && label === 'something downloaded' ? label : `${READ_WORDS[kind]}${label}`;
  return <TaintNotice read={read} first={first} />;
}

export function MemoryPill({ item }: { item: Of<'memory'> }) {
  const client = useQueryClient();
  const [answer, setAnswer] = useState<'undone' | 'kept'>();
  // The pill says what you pressed at once; it goes back if that didn't work.
  const act = async (keep: boolean) => {
    const before = answer;
    setAnswer(keep ? 'kept' : 'undone');
    try {
      if (keep) await memoryApi.keep(item.memoryId);
      else await api.deleteMemory(item.memoryId);
      void client.invalidateQueries({ queryKey: keys.memories });
    } catch (e) {
      setAnswer(before);
      toast.error((e as Error).message);
    }
  };
  // Learned in a chat that read something from outside: it waits for an OK (ADR 0032).
  const waiting = item.action === 'saved' && item.pending && !answer;
  const label =
    answer === 'undone' || item.action === 'forgotten'
      ? 'Forgot'
      : waiting
        ? 'Wants to remember'
        : 'Remembered';
  return (
    <div
      className={styles.memory}
      data-action={answer === 'undone' ? 'undone' : item.action}
      data-waiting={waiting || undefined}
    >
      <Brain aria-hidden />
      <span className={styles.memoryText}>
        {label}: {item.content}
        {waiting && (
          <span className={styles.memoryWhy}>
            {' '}
            This chat read something from outside, so it waits for your OK.
          </span>
        )}
      </span>
      {waiting ? (
        <>
          <Button variant="soft" size="sm" onClick={() => void act(true)}>
            Keep
          </Button>
          <Button variant="ghost" tone="neutral" size="sm" onClick={() => void act(false)}>
            Forget
          </Button>
        </>
      ) : (
        item.action === 'saved' &&
        answer !== 'undone' && (
          <Button variant="ghost" size="sm" leadingIcon={<Undo2 />} onClick={() => void act(false)}>
            Undo
          </Button>
        )
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
  /** The latest turn paused to check in (ADR 0077): send “Carry on”. */
  onCarryOn?: () => void;
}) {
  if (item.outcome === 'success' && item.paused) {
    // Once the chat has moved on, a pause is a quiet note in its history.
    if (!onCarryOn) return <div className={styles.stopped}>{item.paused.message}</div>;
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
  if (item.outcome === 'interrupted') {
    return (
      <div className={styles.stopped}>
        Stopped
        {/* What it had spent by then, quietly (ADR 0079). */}
        {item.cost && <TurnCostTag cost={item.cost} tokens={item.usage} />}
      </div>
    );
  }
  // An earlier failure the chat has moved past: a quiet line, not an alarm.
  if (item.outcome === 'error' && item.problem && !onRetry) {
    return <div className={styles.stopped}>Didn’t go through: {item.error}</div>;
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
