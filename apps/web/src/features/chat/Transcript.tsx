import { MessageList, SkillHoldEnded } from '@conch/nacre';
import { useState, type ReactNode, type Ref } from 'react';

import type { ConversationView, TranscriptItem } from '../../live/reducer';
import { verbsFor } from './stream';
import {
  AssistantMessage,
  Arrival,
  AssistantPlaceholder,
  MemoryPill,
  TaintItem,
  SkillUsedLine,
  PermissionCard,
  ToolItem,
  TurnEnd,
  UserMessage,
  Waiting,
  type TurnRecovery,
  type Wait,
} from './TranscriptItems';
import { BrowserApprovalItem, BrowserTrailItem, HandoffItem } from '../browser/ChatCards';
import { IntegrationIssue, IntegrationSuggestion } from '../integrations/ChatBits';
import { NeedsAppsItem } from './NeedsApps';
import { PastChatsItem } from './PastChatsItem';
import { HeldItem, RoutedItem } from './OfflineBits';
import { ArtifactChatCard } from '../artifacts/ArtifactChatCard';
import { RoutineChatCard } from '../routines/RoutineChatCard';
import { ChatFiles, turnChanges } from '../undo/ChatFiles';
import { TaskChatCard } from '../tasks/TaskChatCard';
import { RoutineInstruction } from '../routines/RunBanner';
import styles from './Transcript.module.css';
import { VaultApprovalItem, VaultRequestItem } from './VaultItems';
import type { PendingMessage } from '../../live/store';

export interface TranscriptProps {
  view: ConversationView;
  pending: PendingMessage[];
  name: string;
  onRespond: (permissionId: string, decision: 'allow' | 'allow-always' | 'deny') => void;
  onRetry: () => void;
  /** What the chat can offer about the last failed turn (sign in, another provider…). */
  recover?: TurnRecovery;
  footer?: ReactNode;
  /** Layered over the scrolling log (find bar, match rail). */
  overlay?: ReactNode;
  /** The column holding every message (what find-in-chat searches). */
  columnRef?: Ref<HTMLDivElement>;
  /** For the browser's thumbnails and buttons. */
  conversationId?: string;
  /** Send a message of yours again (an offer to connect an app: “Ask again”). */
  onAskAgain?: (messageId: string) => void;
  /** Give the message box focus back (something that had it went away). */
  focusComposer?: () => void;
}

/** Tolerance for the gateway's clock running a little behind this device's. */
const CLOCK_SLACK_MS = 1500;

interface Block {
  key: string;
  /** When the block (or the latest thing before it) happened, for telling live from history. */
  at: number;
  tools?: Extract<TranscriptItem, { kind: 'tool' }>[];
  browser?: Extract<TranscriptItem, { kind: 'browser' }>[];
  item?: TranscriptItem;
}

/** Said between browser steps, without ending the trail: an answered site question, a page read. */
const aside = (block: Block) =>
  block.item?.kind === 'taint' ||
  (block.item?.kind === 'permission' && Boolean(block.item.browser && block.item.decision));

/** Consecutive tool calls are grouped into one tight stack; browser steps into one trail. */
function blocks(items: TranscriptItem[]): Block[] {
  const out: Block[] = [];
  let at = 0;
  for (const item of items) {
    at = timeOf(item) ?? at;
    const last = out.at(-1);
    if (item.kind === 'tool') {
      if (last?.tools) last.tools.push(item);
      else out.push({ key: `tools-${item.id}`, tools: [item], at });
    } else if (item.kind === 'browser') {
      // Browsing goes on in the same trail past an answered site question and
      // the note that it read a page (both show under it), rather than starting
      // a new one.
      const trail = out.findLast((b) => !aside(b));
      if (trail?.browser) trail.browser.push(item);
      else out.push({ key: `browser-${item.id}`, browser: [item], at });
    } else {
      out.push({ key: `${item.kind}-${item.id}`, item, at });
    }
  }
  return out;
}

/**
 * An offer to connect an app is logged as the turn starts, but it belongs
 * under the reply: the answer says what it can do without the app, and the
 * offer is right there after it. While the turn runs it waits.
 */
function placeSuggestions(items: TranscriptItem[], holdLast: boolean): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  let held: TranscriptItem[] = [];
  for (const item of items) {
    if (item.kind === 'integration-suggestion') {
      held.push(item);
      continue;
    }
    if (item.kind === 'user' && held.length) {
      out.push(...held);
      held = [];
    }
    out.push(item);
  }
  return holdLast ? out : [...out, ...held];
}

function timeOf(item: TranscriptItem): number | undefined {
  if (item.kind === 'user') return item.at;
  if (item.kind === 'assistant' || item.kind === 'tool') return item.startedAt;
  if (item.kind === 'browser' || item.kind === 'artifact' || item.kind === 'looked') return item.at;
  return undefined;
}

export function Transcript({
  view,
  pending,
  name,
  onRespond,
  onRetry,
  recover,
  footer,
  overlay,
  columnRef,
  conversationId,
  routineRun,
  taskChat,
  onAskAgain,
  focusComposer,
}: TranscriptProps & {
  /** This conversation is a routine run: its first message is the routine's instruction. */
  routineRun?: boolean;
  /** This conversation is a task's: a skill carried into it came from the chat it started in. */
  taskChat?: boolean;
}) {
  // News is what happened after the chat was opened. A reload replays history as a
  // burst of events (turn status included), so their own timestamps are what tell.
  const [openedAt] = useState(() => Date.now());
  const firstUserId = routineRun ? view.items.find((i) => i.kind === 'user')?.id : undefined;
  const running = view.status === 'running' || view.status === 'awaiting-permission';
  const items: TranscriptItem[] = [
    ...view.items,
    ...pending.map((p) => ({
      kind: 'user' as const,
      id: p.clientMessageId,
      text: p.text,
      at: p.at,
      pending: true,
      ...(p.attachments && { attachments: p.attachments }),
    })),
  ];
  // The model's hidden reasoning arrives as empty items that render nothing, so they
  // mustn't count as "something arrived" — the wait stays until there's something to see.
  // Offers to connect an app wait for the reply, so they don't count either.
  const last = items
    .filter(
      (i) =>
        !(i.kind === 'assistant' && !i.text && !i.thinking) && i.kind !== 'integration-suggestion',
    )
    .at(-1);
  const lastErrorId = [...items].reverse().find((i) => i.kind === 'turn-end')?.id;
  // The first time a chat reads something from outside says what changes; the rest are brief.
  const firstTaint = items.find((i) => i.kind === 'taint')?.id;
  const turns = turnChanges(items);
  const turnStart = items.findLastIndex((i) => i.kind === 'user');
  const prompt = turnStart === -1 ? '' : (items[turnStart] as { text: string }).text;
  // Waiting on you (a question, a handoff): no "working…" while it's your move.
  const handingOff = last?.kind === 'handoff' && last.handoff.state === 'waiting';
  const busy =
    (running || pending.length > 0) && view.status !== 'awaiting-permission' && !handingOff;
  const startedAt = view.turnStartedAt ?? pending[0]?.at;
  const wait: Wait = {
    verbs: verbsFor(prompt, 'starting'),
    startedAt,
    srLabel: `${name} is thinking`,
  };
  const afterTool: Wait = {
    verbs: verbsFor(prompt, 'after-tool'),
    startedAt,
    srLabel: `${name} is working`,
  };
  // Nothing from the assistant yet this turn: hold its place with the wait.
  const placeholder = busy && last?.kind === 'user';
  const lastUserId = items.findLast((i) => i.kind === 'user')?.id;
  const turnRunning = running || pending.length > 0;
  const lastFilesId = items.findLast((i) => i.kind === 'files')?.id;
  // Between steps (a tool finished, a reply paused): a quieter wait that appears only if it lingers.
  const between =
    busy &&
    !placeholder &&
    ((last?.kind === 'tool' && last.status !== 'running' && last.status !== 'pending') ||
      last?.kind === 'memory' ||
      last?.kind === 'looked' ||
      last?.kind === 'files' ||
      last?.kind === 'skill' ||
      last?.kind === 'skill-ended' ||
      last?.kind === 'routine' ||
      last?.kind === 'artifact' ||
      last?.kind === 'task' ||
      last?.kind === 'integration-issue' ||
      last?.kind === 'routed' ||
      (last?.kind === 'browser' && last.step.status !== 'running') ||
      (last?.kind === 'handoff' && last.handoff.state !== 'waiting') ||
      (last?.kind === 'permission' && Boolean(last.decision)) ||
      (last?.kind === 'assistant' && last.done));

  return (
    <MessageList className={styles.list} aria-label="Conversation" overlay={overlay}>
      <div ref={columnRef} className={styles.column}>
        {blocks(placeSuggestions(items, turnRunning)).map((block) => (
          <Arrival key={block.key} live={block.at >= openedAt - CLOCK_SLACK_MS}>
            {block.tools && (
              <div className={styles.tools}>
                {block.tools.map((t) => (
                  <ToolItem key={t.id} item={t} />
                ))}
              </div>
            )}
            {block.item?.kind === 'user' &&
              (block.item.id === firstUserId ? (
                <RoutineInstruction text={block.item.text} />
              ) : (
                <UserMessage item={block.item} />
              ))}
            {block.item?.kind === 'assistant' && (
              <AssistantMessage
                item={block.item}
                name={name}
                wait={busy ? wait : undefined}
                entrance={!(running && items.indexOf(block.item) > turnStart)}
              />
            )}
            {block.browser && conversationId && (
              <div className={styles.tools}>
                <BrowserTrailItem conversationId={conversationId} steps={block.browser} />
              </div>
            )}
            {block.item?.kind === 'handoff' && conversationId && (
              <HandoffItem conversationId={conversationId} item={block.item} name={name} />
            )}
            {block.item?.kind === 'permission' && block.item.browser && conversationId && (
              <BrowserApprovalItem
                conversationId={conversationId}
                item={block.item}
                name={name}
                onRespond={(d) => onRespond((block.item as { id: string }).id, d)}
              />
            )}
            {block.item?.kind === 'permission' && block.item.vault && (
              <VaultApprovalItem
                item={block.item}
                name={name}
                onRespond={(d) => onRespond((block.item as { id: string }).id, d)}
              />
            )}
            {block.item?.kind === 'vault-request' && (
              <VaultRequestItem item={block.item} name={name} />
            )}
            {block.item?.kind === 'permission' && !block.item.browser && !block.item.vault && (
              <PermissionCard
                item={block.item}
                name={name}
                onRespond={(d) => onRespond((block.item as { id: string }).id, d)}
              />
            )}
            {block.item?.kind === 'taint' && (
              <TaintItem item={block.item} first={block.item.id === firstTaint} />
            )}
            {block.item?.kind === 'files' && (
              <ChatFiles
                item={block.item}
                turn={
                  turnRunning && block.item.id === lastFilesId
                    ? undefined
                    : turns.get(block.item.id)
                }
              />
            )}
            {block.item?.kind === 'memory' && <MemoryPill item={block.item} />}
            {block.item?.kind === 'looked' && <PastChatsItem item={block.item} name={name} />}
            {block.item?.kind === 'skill' && (
              <SkillUsedLine item={block.item} carriedFrom={taskChat ? 'chat' : 'helper'} />
            )}
            {block.item?.kind === 'skill-ended' && (
              <SkillHoldEnded title={block.item.title} className={styles.skillUsed} />
            )}
            {block.item?.kind === 'routine' && (
              <RoutineChatCard
                routineId={block.item.routineId}
                title={block.item.title}
                action={block.item.action}
              />
            )}
            {block.item?.kind === 'artifact' && conversationId && (
              <ArtifactChatCard conversationId={conversationId} item={block.item} />
            )}
            {block.item?.kind === 'task' && (
              <TaskChatCard
                taskId={block.item.taskId}
                title={block.item.title}
                kind={block.item.taskKind}
                state={block.item.state}
                summary={block.item.summary}
              />
            )}
            {block.item?.kind === 'integration-issue' && <IntegrationIssue item={block.item} />}
            {block.item?.kind === 'held' && (
              <HeldItem item={block.item} conversationId={conversationId} />
            )}
            {block.item?.kind === 'routed' && <RoutedItem item={block.item} />}
            {block.item?.kind === 'needs-apps' && (
              <NeedsAppsItem item={block.item} conversationId={conversationId} />
            )}
            {block.item?.kind === 'integration-suggestion' && (
              <IntegrationSuggestion
                item={block.item}
                conversationId={conversationId}
                className={styles.suggestion}
                onAskAgain={
                  // Only for the latest question, and not while a reply is being written.
                  !turnRunning && block.item.askedIn && block.item.askedIn === lastUserId
                    ? () => onAskAgain?.((block.item as { askedIn: string }).askedIn)
                    : undefined
                }
                onGone={focusComposer}
              />
            )}
            {block.item?.kind === 'turn-end' && (
              <TurnEnd
                item={block.item}
                onRetry={block.item.id === lastErrorId && !running ? onRetry : undefined}
                recover={block.item.id === lastErrorId && !running ? recover : undefined}
              />
            )}
          </Arrival>
        ))}
        {placeholder && <AssistantPlaceholder name={name} wait={wait} />}
        {between && (
          <div className={styles.between}>
            <Waiting wait={afterTool} compact />
          </div>
        )}
        {footer}
      </div>
    </MessageList>
  );
}
