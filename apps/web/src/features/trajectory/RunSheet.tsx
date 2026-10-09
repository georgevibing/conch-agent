import type { RunTimeline } from '@conch/protocol';
import {
  Button,
  RunReplay,
  Sheet,
  Skeleton,
  Text,
  useMediaQuery,
  type ReplayStep,
  META_SEP,
} from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { ApiError } from '../../api/client';
import { useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';
import { NARROW } from '../../app/widths';
import { useLiveStore } from '../../live/store';
import { useChatAgent } from '../agents/api';
import { trajectoryApi, trajectoryKeys, useHowItDidIt } from './api';
import styles from './Trajectory.module.css';

const ORIGIN: Record<RunTimeline['origin'], string | undefined> = {
  chat: undefined,
  routine: 'A routine’s run',
  task: 'A task in the background',
  channel: 'From a chat app',
  client: 'From another app',
  artifact: 'Refreshing a page it made',
};

/** The timeline's steps as Nacre draws them, with a browser step's picture served by Conch. */
export function replayStepsOf(timeline: RunTimeline): ReplayStep[] {
  return timeline.steps.map((step) => ({
    ...step,
    shot: step.shot
      ? `/api/browser/shots/${encodeURIComponent(timeline.conversationId)}/${encodeURIComponent(step.shot)}`
      : undefined,
  }));
}

/**
 * How it did it (ADR 0113): a chat, a routine's run or a task as a timeline
 * to scrub and replay, over the chat, with the glint every panel has. A step
 * opens the chat right where it happened; **Save it** keeps it as a file.
 */
export function RunSheet() {
  const runFor = useHowItDidIt((s) => s.runFor);
  const close = useHowItDidIt((s) => s.closeRun);
  // Kept while it closes, so the sheet leaves with what it showed.
  const [shown, setShown] = useState(runFor);
  if (runFor && runFor !== shown) setShown(runFor);
  const narrow = useMediaQuery(NARROW);
  return (
    <Sheet.Root open={Boolean(runFor)} onOpenChange={(open) => !open && close()}>
      <Sheet.Content side={narrow ? 'bottom' : 'right'} size="lg" className={styles.sheet}>
        {shown && <RunBody conversationId={shown} />}
      </Sheet.Content>
    </Sheet.Root>
  );
}

function RunBody({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const record = useConversations().data?.find((c) => c.id === conversationId);
  const agent = useChatAgent(record);
  // While it works, the timeline follows: a new step lands as it happens.
  const running = useLiveStore((s) => {
    const status = s.views[conversationId]?.status;
    return status === 'running' || status === 'awaiting-permission';
  });
  const timeline = useQuery({
    queryKey: trajectoryKeys.timeline(conversationId),
    queryFn: () => trajectoryApi.timeline(conversationId),
    refetchInterval: running ? 2500 : false,
    refetchOnWindowFocus: true,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const name = agent?.name ?? 'Conch';
  const data = timeline.data;
  const origin = data && ORIGIN[data.origin];
  const { closeRun, openSave } = useHowItDidIt.getState();

  return (
    <>
      <Sheet.Header>
        <Sheet.Title>How {name} did it</Sheet.Title>
        <Sheet.Description>
          {record?.title ?? data?.title ?? 'This chat'}
          {origin ? `${META_SEP}${origin}` : ''}
        </Sheet.Description>
      </Sheet.Header>
      <Sheet.Body className={styles.body}>
        {data ? (
          <RunReplay
            key={conversationId}
            steps={replayStepsOf(data)}
            turns={data.turns}
            speaker={name}
            more={data.more}
            onJump={(step) => {
              closeRun();
              void navigate(`/c/${conversationId}`);
              // Lands on the moment itself, as Activity and search do.
              if (step.anchor)
                useUi
                  .getState()
                  .openFind(
                    conversationId,
                    undefined,
                    `[data-anchor="${CSS.escape(step.anchor)}"]`,
                  );
            }}
          />
        ) : timeline.isError ? (
          <Text tone="muted">
            {timeline.error instanceof ApiError
              ? timeline.error.message
              : 'Its steps couldn’t be read just now.'}
          </Text>
        ) : (
          <div className={styles.waiting} aria-busy>
            <Skeleton className={styles.waitTrack} />
            <Skeleton className={styles.waitCard} />
          </div>
        )}
      </Sheet.Body>
      <Sheet.Footer>
        <Button
          variant="soft"
          leadingIcon={<Download />}
          disabled={!data?.steps.length}
          onClick={() => openSave({ conversationId })}
        >
          Save it
        </Button>
      </Sheet.Footer>
    </>
  );
}
