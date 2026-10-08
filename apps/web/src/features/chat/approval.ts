/**
 * An approval and the tool call it was about are one thing in the chat
 * (ADR 0028): while it asks, the call's row waits and the card asks under
 * it; once answered, the card goes and the row carries the answer. Read from
 * what was decided (`approval`, the permission's `decision`), never from
 * what the tool said back.
 */
import { approvalOf, type ToolApproval } from '@conch/protocol';
import type { ToolCallStatus } from '@conch/nacre';

import type { TranscriptItem } from '../../live/reducer';

type Tool = Extract<TranscriptItem, { kind: 'tool' }>;
type Permission = Extract<TranscriptItem, { kind: 'permission' }>;

/** The call with the answer it got, from the question about it when the call doesn't say yet. */
export function withAnswer(item: Tool, asked: Permission | undefined): Tool {
  if (item.approval || !asked?.decision) return item;
  return { ...item, approval: approvalOf(asked.decision) };
}

const OUTCOME: Partial<Record<ToolApproval, string>> = {
  declined: 'You said no',
  refused: 'Not allowed',
  expired: 'Not answered',
};

const NOTE: Partial<Record<ToolApproval, string>> = {
  allowed: 'You allowed this',
  always: 'Always allowed in this chat',
};

const BASE: Record<Tool['status'], ToolCallStatus> = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  error: 'error',
};

/** How a call's row shows, given the question about it. */
export function rowState(
  item: Tool,
  asking: boolean,
): { status: ToolCallStatus; outcome?: string; note?: string } {
  if (asking) return { status: 'pending', outcome: 'Waiting for you' };
  const approval = item.approval;
  if (approval === 'declined' || approval === 'refused')
    return { status: 'declined', outcome: OUTCOME[approval] };
  // Nobody answered in time (ADR 0108): a no, and the chat says why.
  if (approval === 'expired')
    return {
      status: 'cancelled',
      outcome: item.unanswered
        ? `No answer in ${item.unanswered} minutes, so it didn’t`
        : OUTCOME.expired,
    };
  const stopped = item.status === 'error' && item.output === 'Stopped.';
  const note = approval && NOTE[approval];
  return { status: stopped ? 'cancelled' : BASE[item.status], ...(note && { note }) };
}

/**
 * The questions whose answers fold into a row: answered, about a call that
 * has one. They leave the chat; the row says what was decided.
 */
export function foldedAnswers(items: readonly TranscriptItem[]): Set<string> {
  const rows = new Map(items.flatMap((i) => (i.kind === 'tool' ? [[i.id, i] as const] : [])));
  return new Set(
    items.flatMap((i) => {
      const row = i.kind === 'permission' && i.toolUseId ? rows.get(i.toolUseId) : undefined;
      // An email allowed and still going keeps its card: the letter folds and flies there,
      // and the sent card takes its place once Gmail has answered.
      const going =
        row &&
        i.kind === 'permission' &&
        i.decision === 'allow' &&
        isMailApproval(i.toolName) &&
        (row.status === 'running' || row.status === 'pending');
      return i.kind === 'permission' && i.decision && !i.browser && !i.vault && row && !going
        ? [i.id]
        : [];
    }),
  );
}

/** Conch's own email tools, whose approval card is the letter itself. */
export const isMailApproval = (toolName: string) =>
  /^(?:mcp__conch__)?google_mail_(?:send|create_draft)$/.test(toolName);

/** Each call's question, by the call. */
export function questionsByCall(items: readonly TranscriptItem[]): Map<string, Permission> {
  const out = new Map<string, Permission>();
  for (const i of items) if (i.kind === 'permission' && i.toolUseId) out.set(i.toolUseId, i);
  return out;
}
