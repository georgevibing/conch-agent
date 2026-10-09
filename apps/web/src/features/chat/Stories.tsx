import type { Story } from '@conch/protocol';
import {
  Diff,
  StoryStack,
  ToolCall,
  type StoryExplanation,
  type StoryStackItem,
} from '@conch/nacre';
import { memo, type ReactNode } from 'react';

import type { Narration, StoryHeadline, TranscriptItem } from '../../live/reducer';
import { useToolLabel } from '../integrations/ChatBits';
import { rowState, withAnswer } from './approval';
import { explainStep } from './explain';
import { headlineOf, liveOf, quietFollowers, standsAlone, stepViews, storyStatus } from './telling';
import { ToolFound } from './ToolFound';
import { mailMoment } from './MailItems';
import { MemoryFound } from './MemorySteps';
import { formatInput, managedProcessSummary, toolDiff, toolSummary } from './tools';
import styles from './Transcript.module.css';
import { useArrivedLive } from './TranscriptItems';

type Tool = Extract<TranscriptItem, { kind: 'tool' }>;
type Permission = Extract<TranscriptItem, { kind: 'permission' }>;

/**
 * The exact call behind a step (ADR 0103's third layer): its tool's own name
 * (an app's logo and name), the command or file, how long, then its input,
 * output and diff, already open. What it found is drawn by the step, not here.
 */
const RawCall = memo(function RawCall({
  item: call,
  asked,
  open = true,
}: {
  item: Tool;
  asked?: Permission;
  open?: boolean;
}) {
  const item = withAnswer(call, asked);
  const label = useToolLabel()(item.name, {
    running: item.status === 'running' || item.status === 'pending',
    input: item.input,
    view: item.view,
  });
  const diff = toolDiff(item.name, item.input);
  const row = rowState(item, Boolean(asked && !asked.decision));
  return (
    <ToolCall
      defaultOpen={open}
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
    >
      {diff && <Diff diff={diff} header={false} lineNumbers={false} />}
    </ToolCall>
  );
});

export interface RunStoriesProps {
  /** The run's calls, in order. */
  tools: Tool[];
  /** Them, told as stories (`storiesOf(tools)`). */
  stories: Story[];
  titles?: Readonly<Record<string, StoryHeadline>>;
  narration?: Narration;
  /** Each call's question, if it asked one. */
  asked: ReadonlyMap<string, Permission>;
  conversationId?: string;
  /** Stories opened (by a jump from the away digest, or a press). */
  opened: ReadonlySet<string>;
  onOpen: (storyId: string, open: boolean) => void;
  /** What it remembered or forgot, by the step drawn for each (`MemorySteps`). */
  memories?: ReadonlyMap<string, Extract<TranscriptItem, { kind: 'memory' }>>;
  /**
   * The run isn't over (the last thing in a turn still at work): between two
   * steps its latest story holds as it was while working (Nacre `Story`'s
   * `continuing`), its line saying `pause` (the provider's note since the
   * last step), or its note that still holds, else that it's thinking.
   */
  continuing?: boolean;
  pause?: { text: string; source: Narration['source'] };
}

/**
 * One run of the assistant's steps, told as stories (ADR 0103): a line each,
 * the steps in plain words beneath, the exact calls beneath those. What a
 * step found that's the answer itself (an agenda, emails) stays in sight
 * under its story; the rest is drawn by its step.
 */
export function RunStories({
  tools,
  stories,
  titles,
  narration,
  asked,
  conversationId,
  opened,
  onOpen,
  memories,
  continuing = false,
  pause,
}: RunStoriesProps) {
  const arriving = useArrivedLive();
  const byId = new Map(tools.map((t) => [t.id, t]));
  const quiet = new Map<string, string[]>();
  for (const story of stories)
    for (const [owner, ids] of quietFollowers(story)) quiet.set(owner, ids);

  const renderRaw = (stepId: string) => {
    // A memory has no call to show: what it kept is drawn by the step.
    if (memories?.has(stepId)) return undefined;
    const tool = byId.get(stepId);
    if (!tool) return undefined;
    const after = (quiet.get(stepId) ?? []).flatMap((id) => byId.get(id) ?? []);
    return (
      <div className={styles.raw}>
        <RawCall item={tool} asked={asked.get(stepId)} />
        {after.map((t) => (
          <RawCall key={t.id} item={t} asked={asked.get(t.id)} open={false} />
        ))}
      </div>
    );
  };
  const renderFound = (stepId: string) => {
    const memory = memories?.get(stepId);
    if (memory) return <MemoryFound item={memory} />;
    const view = byId.get(stepId)?.view;
    return view && !standsAlone(view) ? <ToolFound view={view} /> : undefined;
  };
  const onExplain = conversationId
    ? (stepId: string): Promise<StoryExplanation> => explainStep(conversationId, stepId)
    : undefined;

  const item = (story: Story): StoryStackItem => {
    const words = headlineOf(story, titles?.[story.id]);
    const live = liveOf(story, narration, asked, byId);
    const steps = stepViews(story, byId, asked).map((step) =>
      // Said by its own event: there's no call in the log for Why? to ask about.
      memories?.has(step.id) ? { ...step, explainable: false } : step,
    );
    const status = storyStatus(story, steps);
    // The latest story of a run that goes on: between steps it's still at work.
    // Not one you just said no to: that answer shows at once.
    const holds =
      continuing && story === stories.at(-1) && story.status !== 'running' && status !== 'declined';
    // Between steps: the provider's note since the last one, else its words that still hold
    // (they're about the whole run); the rules' words for a step that's over give way to "Thinking…".
    const said = holds
      ? (pause ?? liveOf({ ...story, status: 'running' }, narration, asked, byId))
      : live;
    // Not run because you said no: that's what it came to.
    const outcome =
      status !== story.status && !titles?.[story.id]
        ? steps.find((s) => s.status === 'declined')?.outcome
        : words.outcome;
    return {
      id: story.id,
      // Nothing in it ran: its words say so already ("Didn’t run the tests").
      headline: words.headline,
      ...(outcome && { outcome }),
      headlineSource: words.source,
      family: story.family,
      status,
      steps,
      // A site once, however many of its pages were read.
      chips: story.chips.filter(
        (c, i, all) =>
          c.kind !== 'site' || all.findIndex((o) => o.kind === 'site' && o.label === c.label) === i,
      ),
      repeats: story.repeats,
      ...(story.stuck && { stuck: story.stuck }),
      ...(story.stuckCalm && { stuckTone: 'calm' as const }),
      startedAt: story.startedAt,
      ...(story.durationMs !== undefined && { durationMs: story.durationMs }),
      ...(said && { live: said.text, liveSource: said.source }),
      ...(holds && { continuing: true }),
      open: opened.has(story.id),
      onOpenChange: (open: boolean) => onOpen(story.id, open),
      // Where a jump lands (the away digest, find).
      ...({ 'data-story': story.id } as object),
    };
  };

  // A story whose step found the answer ends its stack; the answer follows it.
  const parts: ReactNode[] = [];
  let stack: Story[] = [];
  const flush = () => {
    if (!stack.length) return;
    parts.push(
      <StoryStack
        key={`stack-${stack[0]?.id}`}
        stories={stack.map(item)}
        renderRaw={renderRaw}
        renderFound={renderFound}
        onExplain={onExplain}
        arriving={arriving}
      />,
    );
    stack = [];
  };
  for (const story of stories) {
    stack.push(story);
    const found = story.steps.flatMap((s): { id: string; kind: string; node: ReactNode }[] => {
      const tool = byId.get(s.id);
      const view = tool?.view;
      if (standsAlone(view))
        return [{ id: s.id, kind: view.kind, node: <ToolFound view={view} /> }];
      // An email on its way, or one that didn't go or may have: its card, from the call.
      const moment = tool && mailMoment(tool, asked.get(s.id));
      return moment ? [{ id: s.id, kind: 'mail-sent', node: moment }] : [];
    });
    if (!found.length) continue;
    flush();
    for (const { id, kind, node } of found)
      parts.push(
        <div key={`found-${id}`} className={styles.found} data-view={kind}>
          {node}
        </div>,
      );
  }
  flush();
  return <div className={styles.run}>{parts}</div>;
}
