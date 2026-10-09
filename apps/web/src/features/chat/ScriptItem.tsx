/**
 * A script that calls tools (ADR 0119), in the chat: one story for the whole
 * run, however many calls it makes. Its calls are told by the same rules as
 * every other step (`stepFromTool`), its question waits under its line, and
 * Undo takes back everything it changed at once.
 */
import { stepFromTool, type ScriptCall, type ToolStatus } from '@conch/protocol';
import {
  ScriptRun,
  type ScriptRunAsk,
  type ScriptRunCall,
  type ScriptRunTally,
  type StoryFamily,
} from '@conch/nacre';
import type { MailEdit } from '@conch/protocol';

import type { TranscriptItem } from '../../live/reducer';
import { askUndo } from '../undo/UndoHost';
import { PermissionCard, useArrivedLive } from './TranscriptItems';

type Of<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;

/** The tools a script reaches by their own names; the rest are Conch's (`mcp__conch__…`). */
const COMPUTER = new Set(['Read', 'LS', 'Write', 'Edit', 'Bash']);
const nameOf = (tool: string) => (COMPUTER.has(tool) ? tool : `mcp__conch__${tool}`);

const parsed = (input: string): unknown => {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return {};
  }
};

const STATUS: Record<ScriptCall['status'], ToolStatus> = {
  running: 'running',
  success: 'success',
  error: 'error',
  declined: 'error',
};

/** One call in plain words, by the rules every step is told by. */
function told(call: ScriptCall) {
  return stepFromTool({
    id: call.callId,
    name: nameOf(call.tool),
    input: parsed(call.input),
    status: STATUS[call.status],
    ...(call.output !== undefined && { output: call.output }),
    startedAt: 0,
    ...(call.status === 'declined' && { approval: 'declined' as const }),
  }).label;
}

const ANSWERS = {
  allow: 'allowed',
  'allow-always': 'always',
  deny: 'declined',
  expired: 'expired',
} as const;

export function ScriptItem({
  item,
  asked,
  files,
  name,
  onRespond,
  onStop,
}: {
  item: Of<'script'>;
  /** The questions it asked, in order. */
  asked: Of<'permission'>[];
  /** What it changed: change sets from its calls. */
  files: Of<'files'>[];
  name: string;
  onRespond: (
    permissionId: string,
    decision: 'allow' | 'allow-always' | 'deny',
    edit?: MailEdit,
  ) => void;
  onStop?: () => void;
}) {
  const arriving = useArrivedLive();
  const { run } = item;
  const running = run.state === 'running';

  // Each kind of call, in words from its first call: "Read an email" ×300.
  const first = new Map<string, ScriptCall>();
  for (const call of item.calls) if (!first.has(call.tool)) first.set(call.tool, call);
  const tally: ScriptRunTally[] = run.tally.map((t) => {
    const call = first.get(t.tool);
    const words = call ? told({ ...call, status: 'success' }) : undefined;
    return {
      tool: t.tool,
      label: words?.done ?? t.tool.replaceAll('_', ' '),
      family: (words?.family ?? 'other') as StoryFamily,
      calls: t.calls,
      ...(t.running && { running: t.running }),
      ...(t.failed && { failed: t.failed }),
      ...(t.declined && { declined: t.declined }),
    };
  });
  const calls: ScriptRunCall[] = item.calls.map((call) => {
    const words = told(call);
    return {
      id: call.callId,
      step: call.step,
      tool: call.tool,
      summary: words.subject ?? (call.status === 'running' ? words.doing : words.done),
      status: call.status,
      input: call.input,
      ...(call.output !== undefined && { output: call.output }),
      ...(call.durationMs !== undefined && { durationMs: call.durationMs }),
    };
  });
  const latest = item.calls.findLast((c) => c.status === 'running');

  const asks: ScriptRunAsk[] = asked.map((p) => ({
    id: p.id,
    step: p.script?.step ?? 0,
    text: p.title ?? p.summary,
    answer: p.decision ? ANSWERS[p.decision] : 'waiting',
  }));
  const waiting = asked.findLast((p) => !p.decision);

  const sets = files.map((f) => f.id);
  const changed = files.reduce((n, f) => n + f.files.length, 0);
  const undone = files.length > 0 && files.every((f) => f.state === 'undone');

  return (
    <ScriptRun
      title={run.title}
      {...(run.note && !running && { headline: run.note })}
      state={run.state}
      {...((run.note ?? latest) && {
        live: run.note ?? (latest ? told(latest).doing : undefined),
      })}
      {...(run.progress && { progress: run.progress })}
      tally={tally}
      calls={calls}
      callCount={run.calls}
      script={run.script ?? ''}
      {...(run.result && { result: run.result })}
      {...(run.error && { error: run.error })}
      asks={asks}
      {...(waiting && {
        approval: (
          <PermissionCard
            item={{
              ...waiting,
              // Which call of which script, so a yes is never a yes to something unseen.
              detail: [
                `Step ${waiting.script?.step ?? '?'} of the script`,
                run.title,
                waiting.detail,
              ]
                .filter(Boolean)
                .join(' · '),
            }}
            name={name}
            onRespond={(decision, edit) => onRespond(waiting.id, decision, edit)}
          />
        ),
      })}
      startedAt={run.startedAt}
      {...(run.durationMs !== undefined && { durationMs: run.durationMs })}
      {...(changed > 0 && {
        changes: {
          count: changed,
          undone,
          onUndo: () => askUndo(sets, 'undo'),
          onRedo: () => askUndo(sets, 'redo'),
        },
      })}
      {...(running && onStop && { onStop })}
      arriving={arriving}
      data-script={run.runId}
    />
  );
}
