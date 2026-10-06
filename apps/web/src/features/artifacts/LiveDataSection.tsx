import { LiveDataList, Skeleton, type LiveDataApprovalView } from '@conch/nacre';
import { useEffect, useRef } from 'react';

import { useUi } from '../../app/ui';
import { Section } from '../settings/Section';
import { useLiveApprovals, useRevokeLive } from './live';
import { useArtifacts } from './queries';

/** `openSettings('security', LIVE_DATA_FOCUS)` brings Live data in pages into view. */
export const LIVE_DATA_FOCUS = 'live-data';

const day = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Settings → Security → Live data in pages (ADR 0046): every site a page the
 * assistant made may read from, because you said so, each taken back in one
 * press. A page asks again the next time it wants to.
 */
export function LiveDataSection({ focus }: { focus?: { place: string; done: () => void } }) {
  const { data: approvals, isPending } = useLiveApprovals();
  const { data: artifacts } = useArtifacts();
  const revoke = useRevokeLive();
  const navigate = (path: string) =>
    window.dispatchEvent(new CustomEvent('conch:navigate', { detail: path }));
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focus?.place !== 'live-data') return;
    focus.done();
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
    ref.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [focus]);

  const views: LiveDataApprovalView[] = (approvals ?? []).map((a) => ({
    artifactId: a.artifactId,
    title: a.title,
    host: a.host,
    local: a.local,
    when: day(a.at),
  }));

  return (
    <Section
      ref={ref}
      title="Live data in pages"
      description="Sites a page your assistant made may read from — never with your cookies."
    >
      {isPending ? (
        <Skeleton shape="block" height={64} />
      ) : (
        <LiveDataList
          approvals={views}
          onRevoke={(a) => revoke.mutate({ artifactId: a.artifactId, host: a.host })}
          onOpen={(a) => {
            const made = artifacts?.find((x) => x.id === a.artifactId);
            if (made?.pinned || !made?.conversationId) return navigate(`/apps/${a.artifactId}`);
            useUi.getState().openArtifact(made.conversationId, made.id);
            navigate(`/c/${made.conversationId}`);
          }}
        />
      )}
    </Section>
  );
}
