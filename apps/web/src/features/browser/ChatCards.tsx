import { BrowserApproval, BrowserHandoff, BrowserTrail, toast } from '@conch/nacre';
import { useState } from 'react';

import { useUi } from '../../app/ui';
import type { TranscriptItem } from '../../live/reducer';
import { browserApi, shotUrl } from './api';

type Of<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;

/** Consecutive browser steps as one growing filmstrip. */
export function BrowserTrailItem({
  conversationId,
  steps,
}: {
  conversationId: string;
  steps: Of<'browser'>[];
}) {
  const openBrowser = useUi((s) => s.openBrowser);
  return (
    <BrowserTrail
      steps={steps.map(({ step }) => ({
        id: step.stepId,
        status: step.status,
        label: step.label,
        url: step.url,
        title: step.title,
        shot: shotUrl(conversationId, step.shot),
        by: step.by,
      }))}
      onShow={() => openBrowser(conversationId)}
    />
  );
}

/** "Your turn": the assistant waits for you in the browser. */
export function HandoffItem({
  conversationId,
  item,
  name,
}: {
  conversationId: string;
  item: Of<'handoff'>;
  name: string;
}) {
  const openBrowser = useUi((s) => s.openBrowser);
  // Pressed here: done at once, back to waiting only if it didn't go through.
  const [done, setDone] = useState(false);
  return (
    <BrowserHandoff
      reason={item.handoff.reason}
      state={item.handoff.state === 'waiting' && done ? 'done' : item.handoff.state}
      auto={item.handoff.auto}
      name={name}
      onShow={() => openBrowser(conversationId)}
      onDone={() => {
        setDone(true);
        void browserApi.control(conversationId, 'agent').catch(() => {
          setDone(false);
          toast.error('Couldn’t hand the browser back', {
            description: 'Open the browser and press “I’m done” there.',
          });
        });
      }}
    />
  );
}

/** The browser's question about a site or a significant action. */
export function BrowserApprovalItem({
  conversationId,
  item,
  name,
  onRespond,
}: {
  conversationId: string;
  item: Of<'permission'>;
  name: string;
  onRespond: (decision: 'allow' | 'allow-always' | 'deny') => void;
}) {
  const [busy, setBusy] = useState(false);
  const detail = item.browser;
  if (!detail) return null;
  return (
    <BrowserApproval
      kind={detail.kind}
      site={detail.site}
      action={detail.action}
      shot={shotUrl(conversationId, detail.shot)}
      box={detail.box}
      name={name}
      decision={item.decision}
      guard={item.caution ?? item.taint}
      ownChrome={detail.ownChrome}
      busy={busy}
      onDecide={(decision) => {
        setBusy(true);
        onRespond(decision);
      }}
    />
  );
}
