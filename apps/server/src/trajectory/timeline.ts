/**
 * How I did it (ADR 0113): a chat's log as a timeline of steps on a time axis.
 * Every provider's turns reach the log in the same events, so this reads them
 * all the same way; nothing here asks which engine answered.
 */
import {
  describeTool,
  RUN_STEP_LIMIT,
  type ConversationEvent,
  type ConversationSummary,
  type RunStep,
  type RunTimeline,
  type RunTotals,
  type RunTurn,
} from '@conch/protocol';

import { compact } from '../conversations/store';

const PEEK = 1200;
const DIFF_LINES = 240;

export const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** One line of someone's words: the first, trimmed. */
const line = (text: string, max = 120) => clip(text.replace(/\s+/g, ' ').trim(), max);

type Input = Record<string, unknown>;
const record = (value: unknown): Input =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Input) : {};
const str = (input: Input, key: string) =>
  typeof input[key] === 'string' ? (input[key] as string) : undefined;

/** What a file tool changed, as `-` and `+` lines (Conch's own tools and Claude Code's share the shape). */
export function diffOf(name: string, raw: unknown): string | undefined {
  const input = record(raw);
  const lines = (text: string | undefined, mark: '+' | '-') =>
    (text ?? '').split('\n').map((t) => `${mark}${t}`);
  let out: string[] | undefined;
  if (name === 'Edit')
    out = [...lines(str(input, 'old_string'), '-'), ...lines(str(input, 'new_string'), '+')];
  else if (name === 'MultiEdit' && Array.isArray(input.edits))
    out = input.edits.flatMap((edit, i) => [
      ...(i > 0 ? ['@@ … @@'] : []),
      ...lines(str(record(edit), 'old_string'), '-'),
      ...lines(str(record(edit), 'new_string'), '+'),
    ]);
  else if (name === 'Write' && str(input, 'content') !== undefined)
    out = lines(str(input, 'content'), '+');
  if (!out) return undefined;
  const kept = out.slice(0, DIFF_LINES).map((l) => clip(l, 400));
  if (out.length > DIFF_LINES) kept.push(`@@ ${out.length - DIFF_LINES} more lines @@`);
  return kept.join('\n');
}

const ANSWERED: Record<string, { detail: string; status: RunStep['status'] }> = {
  allow: { detail: 'You allowed it', status: 'done' },
  'allow-always': { detail: 'You allowed it for the rest of the chat', status: 'done' },
  deny: { detail: 'You said no', status: 'declined' },
  expired: { detail: 'Nobody answered in time', status: 'declined' },
};

function originOf(chat: Pick<ConversationSummary, 'origin'>): RunTimeline['origin'] {
  switch (chat.origin?.kind) {
    case 'routine':
    case 'task':
    case 'channel':
    case 'client':
    case 'artifact':
      return chat.origin.kind;
    default:
      return 'chat';
  }
}

/** A chat's log, as the steps it took (oldest first). */
export function timelineOf(
  chat: Pick<ConversationSummary, 'id' | 'title' | 'origin' | 'createdAt'>,
  log: ConversationEvent[],
): RunTimeline {
  const events = compact(log);
  const steps: RunStep[] = [];
  const turns: RunTurn[] = [];
  const at = new Map<string, number>(); // step id → its place in `steps`
  let turn = -1;
  let prevAt = events[0]?.at ?? chat.createdAt;
  const started = new Map<string, { name: string; input: unknown; at: number }>();
  const asked = new Map<string, number>();

  const put = (step: Omit<RunStep, 'turn'>) => {
    const full = { ...step, turn: Math.max(0, turn) } as RunStep;
    const known = at.get(step.id);
    if (known !== undefined) steps[known] = full;
    else {
      at.set(step.id, steps.length);
      steps.push(full);
    }
  };
  const openTurn = (when: number) => {
    turn++;
    turns.push({ index: turn, at: when });
  };

  for (const e of events) {
    switch (e.type) {
      case 'user.message': {
        openTurn(e.at);
        const files = e.attachments?.length ?? 0;
        put({
          id: `asked:${e.messageId}`,
          kind: 'asked',
          at: e.at,
          title: e.text.trim() ? line(e.text) : files ? 'You sent files' : 'You wrote',
          ...(files > 0 && { detail: files === 1 ? 'With a file' : `With ${files} files` }),
          ...(e.text.length > 120 && { peek: clip(e.text, PEEK) }),
          anchor: e.messageId,
        });
        break;
      }
      case 'assistant.delta': {
        if (turn < 0) openTurn(prevAt);
        if (!e.delta.trim()) break;
        const thought = e.kind === 'thinking';
        const id = `${thought ? 'thought' : 'said'}:${e.messageId}:${e.seq}`;
        put({
          id,
          kind: thought ? 'thought' : 'said',
          at: prevAt,
          durationMs: Math.max(0, e.at - prevAt),
          title: thought ? 'Thought it through' : line(e.delta),
          peek: clip(e.delta.trim(), PEEK),
          anchor: e.messageId,
        });
        break;
      }
      case 'tool.started': {
        if (turn < 0) openTurn(e.at);
        started.set(e.toolUseId, { name: e.name, input: e.input, at: e.at });
        const label = e.label ?? describeTool(e.name, e.input);
        const diff = diffOf(e.name, e.input);
        put({
          id: `tool:${e.toolUseId}`,
          kind: 'tool',
          at: e.at,
          family: label.family,
          title: line(label.doing, 200),
          ...(label.subject && { detail: line(label.subject, 400) }),
          status: 'waiting',
          anchor: e.toolUseId,
          ...(diff && { diff }),
        });
        break;
      }
      case 'tool.finished': {
        const call = started.get(e.toolUseId);
        if (!call) break;
        const label =
          e.label ??
          describeTool(call.name, call.input, {
            status: e.status,
            ...(e.output !== undefined && { output: e.output }),
            ...(e.approval && { approval: e.approval }),
          });
        const declined =
          e.approval === 'declined' || e.approval === 'expired' || e.approval === 'refused';
        const failed = !declined && (e.status === 'error' || label.failed);
        const diff = diffOf(call.name, call.input);
        put({
          id: `tool:${e.toolUseId}`,
          kind: 'tool',
          at: call.at,
          durationMs: e.durationMs ?? Math.max(0, e.at - call.at),
          family: label.family,
          title: line(label.done, 200),
          ...((label.outcome ?? label.subject) && {
            detail: line(label.outcome ?? label.subject ?? '', 400),
          }),
          status: declined ? 'declined' : failed ? 'failed' : 'done',
          anchor: e.toolUseId,
          ...(e.output?.trim() && { peek: clip(e.output.trim(), PEEK) }),
          ...(diff && { diff }),
        });
        break;
      }
      case 'permission.requested':
        asked.set(e.permissionId, e.at);
        put({
          id: `approval:${e.permissionId}`,
          kind: 'approval',
          at: e.at,
          title: line(e.title ?? e.summary, 200),
          detail: 'Waiting for you',
          status: 'waiting',
          ...(e.toolUseId && { anchor: e.toolUseId }),
        });
        break;
      case 'permission.resolved': {
        const since = asked.get(e.permissionId);
        const index = at.get(`approval:${e.permissionId}`);
        const step = index === undefined ? undefined : steps[index];
        if (since === undefined || index === undefined || !step) break;
        const answer = ANSWERED[e.decision] ?? ANSWERED.expired;
        steps[index] = {
          ...step,
          durationMs: Math.max(0, e.at - since),
          detail: answer?.detail,
          status: answer?.status,
        };
        break;
      }
      case 'files.changed':
        put({
          id: `files:${e.changeSetId}`,
          kind: 'files',
          at: e.at,
          family: 'edit',
          title: line(e.label, 200),
          detail: line(e.files.map((f) => f.path).join(', '), 400),
          files: e.files.slice(0, 50),
          status: 'done',
          ...(e.toolUseId && { anchor: e.toolUseId }),
        });
        break;
      case 'browser.step':
        put({
          id: `browser:${e.step.stepId}`,
          kind: 'browser',
          at: steps[at.get(`browser:${e.step.stepId}`) ?? -1]?.at ?? e.at,
          family: 'browse',
          title: line(e.step.label, 200),
          ...(e.step.title && { detail: line(e.step.title, 400) }),
          status:
            e.step.status === 'error' ? 'failed' : e.step.status === 'done' ? 'done' : 'waiting',
          url: e.step.url.slice(0, 2000),
          ...(e.step.shot && { shot: e.step.shot }),
          anchor: e.step.stepId,
        });
        break;
      case 'task':
        put({
          id: `task:${e.taskId}`,
          kind: 'task',
          at: steps[at.get(`task:${e.taskId}`) ?? -1]?.at ?? e.at,
          family: 'delegate',
          title: line(`Handed off: ${e.title}`, 200),
          ...(e.summary && { detail: line(e.summary, 400) }),
          status:
            e.state === 'done' || e.state === 'unverified'
              ? 'done'
              : e.state === 'failed' || e.state === 'interrupted'
                ? 'failed'
                : e.state === 'stopped'
                  ? 'declined'
                  : 'waiting',
        });
        break;
      case 'artifact':
        put({
          id: `made:${e.artifactId}:${e.version}`,
          kind: 'made',
          at: e.at,
          family: 'make',
          title: line(`${e.action === 'created' ? 'Made' : 'Updated'} ${e.title}`, 200),
          status: 'done',
        });
        break;
      case 'memory.saved':
        put({
          id: `remembered:${e.memory.id}`,
          kind: 'remembered',
          at: e.at,
          family: 'remember',
          title: 'Remembered something',
          detail: line(e.memory.content, 400),
          status: 'done',
        });
        break;
      case 'turn.completed': {
        const current = turns.at(-1);
        if (current && current.endAt === undefined) {
          current.endAt = e.at;
          current.outcome = e.outcome;
          if (e.engine) current.engine = e.engine;
          if (e.model) current.model = e.model.slice(0, 200);
          if (e.usage) current.usage = e.usage;
          if (e.cost) current.cost = e.cost;
        }
        if (e.outcome === 'error')
          put({
            id: `problem:${e.seq}`,
            kind: 'problem',
            at: e.at,
            title: 'It stopped with a problem',
            ...(e.error && { detail: line(e.error, 400) }),
            status: 'failed',
          });
        break;
      }
      default:
        break;
    }
    prevAt = e.at;
  }

  // A call that never finished in a turn that ended (it was stopped) isn't still running.
  for (const step of steps)
    if (step.status === 'waiting' && step.kind === 'tool' && turns[step.turn]?.endAt !== undefined)
      step.status = 'declined';

  steps.sort((a, b) => a.at - b.at);
  const more = steps.length > RUN_STEP_LIMIT;
  const kept = more ? steps.slice(0, RUN_STEP_LIMIT) : steps;
  const startedAt = events[0]?.at ?? chat.createdAt;
  const endedAt = Math.max(startedAt, events.at(-1)?.at ?? startedAt);

  return {
    conversationId: chat.id,
    title: chat.title,
    origin: originOf(chat),
    startedAt,
    endedAt,
    steps: kept,
    turns,
    totals: totalsOf(kept, turns, endedAt),
    ...(more && { more: true }),
  };
}

function totalsOf(steps: RunStep[], turns: RunTurn[], endedAt: number): RunTotals {
  let durationMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let usd = 0;
  let planTurns = 0;
  for (const t of turns) {
    durationMs += Math.max(0, (t.endAt ?? endedAt) - t.at);
    inputTokens += t.usage?.inputTokens ?? 0;
    outputTokens += t.usage?.outputTokens ?? 0;
    if (t.cost?.billing === 'plan') planTurns++;
    else usd += t.cost?.usd ?? 0;
  }
  return {
    durationMs,
    inputTokens,
    outputTokens,
    usd,
    planTurns,
    tools: steps.filter((s) => s.kind === 'tool').length,
    approvals: steps.filter((s) => s.kind === 'approval').length,
    files: new Set(steps.flatMap((s) => s.files?.map((f) => f.path) ?? [])).size,
    failed: steps.filter((s) => s.status === 'failed').length,
  };
}
