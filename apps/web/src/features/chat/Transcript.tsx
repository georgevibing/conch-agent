import { MessageList, SkillHoldEnded, SummaryDivider } from '@conch/nacre';
import { memo, useState, type ReactNode, type Ref } from 'react';

import { isTurnStart, type ConversationView, type TranscriptItem } from '../../live/reducer';
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
import { IntegrationIssue } from '../integrations/ChatBits';
import { AppOfferItem, AppShareItem } from '../conchapps/ChatCards';
import { OfferAlsoTryItem, OfferItem } from '../offers/OfferItem';
import { NeedsAppsItem } from './NeedsApps';
import { CappedItem, SpendNoteItem } from '../spend/Spend';
import { QuestionItem } from '../questions/QuestionItem';
import { PastChatsItem } from './PastChatsItem';
import { HeldItem, RoutedItem } from './OfflineBits';
import { ArtifactChatCard } from '../artifacts/ArtifactChatCard';
import { RoutineChatCard } from '../routines/RoutineChatCard';
import { ChatFiles, turnChanges } from '../undo/ChatFiles';
import { TaskChatCard } from '../tasks/TaskChatCard';
import { RoutineInstruction } from '../routines/RunBanner';
import { NextReplies } from '../replies/NextReplies';
import { endedPlans } from '../plans/fold';
import { PlanApprovalItem, PlanItem, isPlanApproval } from '../plans/PlanItems';
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
  /** Send a message of yours again (an offer from an older log: “Carry on”). */
  onAskAgain?: (messageId: string) => void;
  /** Send these words, exactly (“Also try” under a reply that carried on). */
  onSend?: (text: string) => void;
  /** Give the message box focus back (something that had it went away). */
  focusComposer?: () => void;
  /** Send a reply chip's words (ADR 0060), as the message box would. */
  onReply?: (text: string) => void;
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
  let turn = '';
  let ends = 0;
  for (const item of items) {
    at = timeOf(item) ?? at;
    const last = out.at(-1);
    if (isTurnStart(item)) {
      turn = item.id;
      ends = 0;
    }
    if (item.kind === 'turn-end') {
      // Keyed by its turn, so "Stopped" drawn the moment Stop is pressed is the
      // same line the gateway's own end replaces, not a second one arriving.
      out.push({ key: `turn-end-${turn}-${ends++}`, item, at });
    } else if (item.kind === 'tool') {
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
 * An offer waits under the reply it came with; one that was taken is where
 * the chat carried on. An app's card (ADR 0061) is logged before the words
 * that introduce it, and belongs under them too.
 */
const heldOffer = (item: TranscriptItem) =>
  (item.kind === 'offer' && item.resolution !== 'accepted') ||
  item.kind === 'conch-app-offer' ||
  item.kind === 'conch-app-share';

/**
 * An offer is logged as the turn starts (or mid-reply), but it belongs under
 * the reply: the answer says what it can do without it, and the offer is
 * right there after it. While the turn runs it waits.
 */
function placeSuggestions(items: TranscriptItem[], holdLast: boolean): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  let held: TranscriptItem[] = [];
  for (const item of items) {
    if (heldOffer(item)) {
      held.push(item);
      continue;
    }
    if (isTurnStart(item) && held.length) {
      out.push(...held);
      held = [];
    }
    out.push(item);
  }
  return holdLast ? out : [...out, ...held];
}

/** Plan mode's question is its own card: the row of the tool that asked would say it twice. */
function withoutPlanTools(items: TranscriptItem[]): TranscriptItem[] {
  return items.filter((i) => !(i.kind === 'tool' && i.name === 'ExitPlanMode'));
}

/** The plan drawn in the same turn before an item, if any. */
function planBefore(items: TranscriptItem[], id: string) {
  const at = items.findIndex((i) => i.id === id);
  const plan = items
    .slice(0, at)
    .findLast((i) => i.kind === 'plan' || i.kind === 'user' || i.kind === 'turn-end');
  return plan?.kind === 'plan' ? plan.steps : undefined;
}

/** A reply: its first words, and everything after them until the next turn (its parts). */
interface Reply {
  head: Block;
  parts: Block[];
}

/**
 * Gathers each reply with what belongs to it, so it's drawn as one: its
 * words, then its tool rows, more words and cards, then its actions. A turn
 * that stopped or failed, or a summary line, ends the reply too.
 */
function replies(all: Block[]): (Block | Reply)[] {
  const out: (Block | Reply)[] = [];
  let open: Reply | undefined;
  for (const block of all) {
    const item = block.item;
    // A turn that ended well says nothing, so the reply goes on to what comes after it (chips).
    const ended = item?.kind === 'turn-end' && item.outcome !== 'success';
    if (item && (isTurnStart(item) || ended || item.kind === 'summary')) {
      open = undefined;
    } else if (item?.kind === 'assistant' && !item.continuation) {
      // A reply with nothing to show yet (hidden reasoning) has no column to hold its parts.
      open = item.text || item.thinking ? { head: block, parts: [] } : undefined;
      out.push(open ?? block);
      continue;
    } else if (open) {
      open.parts.push(block);
      continue;
    }
    out.push(block);
  }
  return out;
}

/** Everything but a message, the line where a turn ended and a summary is part of a reply. */
const isPart = (block: Block) =>
  !block.item ||
  !(
    block.item.kind === 'user' ||
    block.item.kind === 'turn-end' ||
    block.item.kind === 'summary' ||
    (block.item.kind === 'assistant' && !block.item.continuation)
  );

/** How a reply's turn ended (its cost, ADR 0079), once it has. */
function endOf(reply: Reply) {
  const end = reply.parts.findLast((b) => b.item?.kind === 'turn-end')?.item;
  return end?.kind === 'turn-end' ? end : undefined;
}

/** A reply's words, all of them, once every part has finished: what Copy takes. */
function saidIn(reply: Reply): string | undefined {
  const words = [reply.head, ...reply.parts]
    .map((b) => b.item)
    .filter((i): i is Extract<TranscriptItem, { kind: 'assistant' }> => i?.kind === 'assistant');
  if (words.some((w) => !w.done)) return undefined;
  return (
    words
      .map((w) => w.text.trim())
      .filter(Boolean)
      .join('\n\n') || undefined
  );
}

function timeOf(item: TranscriptItem): number | undefined {
  if (item.kind === 'user') return item.at;
  if (item.kind === 'assistant' || item.kind === 'tool') return item.startedAt;
  if (item.kind === 'browser' || item.kind === 'artifact' || item.kind === 'looked') return item.at;
  return undefined;
}

/** Memoised: typing in the composer doesn't draw the whole chat again. */
export const Transcript = memo(function Transcript({
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
  onSend,
  focusComposer,
  onReply,
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
  // Offers wait for the reply, so they don't count either.
  const last = items
    .filter(
      (i) =>
        !(i.kind === 'assistant' && !i.text && !i.thinking) &&
        !heldOffer(i) &&
        // The line where the model's memory starts is a note on history, not news.
        i.kind !== 'summary',
    )
    .at(-1);
  const lastErrorId = [...items].reverse().find((i) => i.kind === 'turn-end')?.id;
  // The first time a chat reads something from outside says what changes; the rest are brief.
  const firstTaint = items.find((i) => i.kind === 'taint')?.id;
  const turns = turnChanges(items);
  const turnStart = items.findLastIndex(isTurnStart);
  const position = new Map(items.map((item, n) => [item, n]));
  const started = items[turnStart];
  const prompt =
    started?.kind === 'user'
      ? started.text
      : started?.kind === 'offer'
        ? (started.offer.resume?.request ?? '')
        : '';
  // Waiting on you (a question, a handoff): no "working…" while it's your move.
  const handingOff = last?.kind === 'handoff' && last.handoff.state === 'waiting';
  // A message just sent here and confirmed, before the gateway says the turn is
  // running (it picks the model and the apps first): still waiting for the
  // answer, so the wait stays up instead of leaving and coming back.
  const starting =
    view.status === 'idle' && last?.kind === 'user' && last.at >= openedAt - CLOCK_SLACK_MS;
  const busy =
    (running || pending.length > 0 || starting) &&
    view.status !== 'awaiting-permission' &&
    !handingOff;
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
  const placeholder = busy && last !== undefined && isTurnStart(last);
  // What else an app just connected can do, once the reply that carried on is done.
  const alsoTry =
    started?.kind === 'offer' && started.offer.kind === 'app' && !(running || pending.length)
      ? started.offer.target
      : undefined;
  const lastUserId = items.findLast((i) => i.kind === 'user')?.id;
  const turnRunning = running || pending.length > 0;
  const lastFilesId = items.findLast((i) => i.kind === 'files')?.id;
  // A plan folds to one line once its turn ends (ADR 0060).
  const ended = endedPlans(items);
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
      last?.kind === 'plan' ||
      (last?.kind === 'browser' && last.step.status !== 'running') ||
      (last?.kind === 'handoff' && last.handoff.state !== 'waiting') ||
      (last?.kind === 'permission' && Boolean(last.decision)) ||
      (last?.kind === 'question' && last.answer !== undefined) ||
      (last?.kind === 'assistant' && last.done));

  const rows = replies(blocks(placeSuggestions(withoutPlanTools(items), turnRunning)));
  const lastRow = rows.at(-1);
  const live = (block: Block) => block.at >= openedAt - CLOCK_SLACK_MS;
  // What comes after the latest reply, once it's over: drawn as parts of it when it's a reply.
  const tail = {
    alsoTry: alsoTry && onSend && <OfferAlsoTryItem target={alsoTry} onSend={onSend} />,
    replies: onReply && (
      <NextReplies view={view} waiting={pending.length > 0} openedAt={openedAt} onSend={onReply} />
    ),
    footer,
  };
  const tailParts = (
    <>
      {tail.alsoTry && <div className={styles.part}>{tail.alsoTry}</div>}
      {tail.replies && <div className={styles.part}>{tail.replies}</div>}
      {tail.footer && <div className={styles.part}>{tail.footer}</div>}
    </>
  );
  const tailAttached = lastRow !== undefined && 'head' in lastRow;

  const render = (block: Block, rest?: Reply) => (
    <>
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
          entrance={!(running && (position.get(block.item) ?? -1) > turnStart)}
          {...(rest && {
            attached: (
              <>
                {rest.parts.map((part) => (
                  <Arrival key={part.key} live={live(part)} part>
                    {render(part)}
                  </Arrival>
                ))}
                {rest === lastRow && tailParts}
              </>
            ),
            said: rest === lastRow && turnRunning ? undefined : saidIn(rest),
            ended: endOf(rest),
          })}
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
      {block.item?.kind === 'vault-request' && <VaultRequestItem item={block.item} name={name} />}
      {block.item?.kind === 'plan' && (
        <PlanItem item={block.item} ended={ended.has(block.item.id)} />
      )}
      {block.item && isPlanApproval(block.item) && block.item.kind === 'permission' && (
        <PlanApprovalItem
          item={block.item}
          name={name}
          steps={planBefore(items, block.item.id)}
          onRespond={(d) => onRespond((block.item as { id: string }).id, d)}
          focusComposer={focusComposer}
        />
      )}
      {block.item?.kind === 'question' && (
        <QuestionItem
          item={block.item}
          conversationId={conversationId}
          name={name}
          waiting={running}
        />
      )}
      {block.item?.kind === 'permission' &&
        !block.item.browser &&
        !block.item.vault &&
        !isPlanApproval(block.item) && (
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
          turn={turnRunning && block.item.id === lastFilesId ? undefined : turns.get(block.item.id)}
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
          by={block.item.by}
        />
      )}
      {block.item?.kind === 'integration-issue' && <IntegrationIssue item={block.item} />}
      {block.item?.kind === 'held' && (
        <HeldItem item={block.item} conversationId={conversationId} />
      )}
      {block.item?.kind === 'routed' && <RoutedItem item={block.item} />}
      {block.item?.kind === 'summary' && (
        <SummaryDivider
          model={block.item.model}
          summary={block.item.summary}
          className={styles.summary}
        />
      )}
      {block.item?.kind === 'needs-apps' && (
        <NeedsAppsItem item={block.item} conversationId={conversationId} />
      )}
      {block.item?.kind === 'capped' && (
        <CappedItem item={block.item} conversationId={conversationId} />
      )}
      {block.item?.kind === 'spend-note' && <SpendNoteItem item={block.item} />}
      {block.item?.kind === 'offer' && (
        <OfferItem
          item={block.item}
          conversationId={conversationId}
          onAskAgain={
            // An older offer: only for the latest question, and not while a reply is being written.
            !turnRunning && block.item.askedIn && block.item.askedIn === lastUserId
              ? () => onAskAgain?.((block.item as { askedIn: string }).askedIn)
              : undefined
          }
          focusComposer={focusComposer}
        />
      )}
      {block.item?.kind === 'conch-app-offer' && (
        <AppOfferItem
          item={block.item}
          conversationId={conversationId}
          onSend={onReply ?? onSend}
        />
      )}
      {block.item?.kind === 'conch-app-share' && <AppShareItem item={block.item} />}
      {block.item?.kind === 'turn-end' && (
        <TurnEnd
          item={block.item}
          onRetry={block.item.id === lastErrorId && !running ? onRetry : undefined}
          recover={block.item.id === lastErrorId && !running ? recover : undefined}
          onCarryOn={
            block.item.id === lastErrorId && !running && !pending.length && (onReply ?? onSend)
              ? () => (onReply ?? onSend)?.('Carry on')
              : undefined
          }
        />
      )}
    </>
  );

  return (
    <MessageList
      className={styles.list}
      aria-label="Conversation"
      overlay={overlay}
      // What you just sent is what you want to see, wherever you'd scrolled to.
      follow={pending.at(-1)?.clientMessageId}
    >
      <div ref={columnRef} className={styles.column}>
        {rows.map((row) =>
          'head' in row ? (
            <Arrival key={row.head.key} live={live(row.head)}>
              {render(row.head, row)}
            </Arrival>
          ) : (
            <Arrival key={row.key} live={live(row)} part={isPart(row)}>
              {render(row)}
            </Arrival>
          ),
        )}
        {placeholder && <AssistantPlaceholder name={name} wait={wait} />}
        {!tailAttached && tail.alsoTry && <div className={styles.part}>{tail.alsoTry}</div>}
        {between && (
          <div className={`${styles.part} ${styles.between}`}>
            <Waiting wait={afterTool} compact />
          </div>
        )}
        {!tailAttached && tail.replies && <div className={styles.part}>{tail.replies}</div>}
        {!tailAttached && tail.footer && <div className={styles.part}>{tail.footer}</div>}
      </div>
    </MessageList>
  );
});
