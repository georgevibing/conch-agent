import type { BrowserStatus } from '@conch/protocol';
import { BrowserWindow, toast, type BrowserWindowPhase } from '@conch/nacre';
import { useCallback, useEffect } from 'react';

import { useAssistantName } from '../integrations/queries';
import { useUi } from '../../app/ui';
import { useBrowserStatus, useRepairBrowser } from './queries';
import { useBrowserLive } from './useBrowserLive';

function phaseOf(status: BrowserStatus | undefined, live: string): BrowserWindowPhase {
  if (live === 'connecting' && !status) return 'connecting';
  switch (status?.phase) {
    case 'installing':
      return 'installing';
    case 'starting':
    case 'repairing':
      return 'starting';
    case 'problem':
      return 'problem';
    case 'running':
      return 'running';
    default:
      return 'off';
  }
}

/** A chat's browser: the live page, and your hands on it. */
export function BrowserPanel({
  conversationId,
  visible = true,
  onClose,
}: {
  conversationId: string;
  visible?: boolean;
  onClose?: () => void;
}) {
  const { data: status } = useBrowserStatus();
  const live = useBrowserLive(conversationId, visible);
  const name = useAssistantName();
  const repair = useRepairBrowser();
  const openSettings = useUi((s) => s.openSettings);
  const { send } = live;
  const fit = useCallback(
    (size: { width: number; height: number }) => send({ type: 'fit', ...size }),
    [send],
  );

  // Problems the live view reports (a blocked address…) show once, as a toast.
  useEffect(() => {
    if (!live.error) return;
    toast(live.error);
    live.clearError();
  }, [live]);

  const problem = status?.problem;
  const action =
    problem?.action === 'settings'
      ? { actionLabel: 'Open settings', onAction: () => openSettings('browser') }
      : problem?.action === 'repair' || problem?.action === 'install' || problem?.action === 'retry'
        ? {
            actionLabel: problem.action === 'repair' ? 'Repair' : 'Try again',
            onAction: () => repair.mutate(),
          }
        : {};

  return (
    <BrowserWindow
      tab={live.tab}
      phase={phaseOf(status, live.state)}
      install={status?.install}
      problem={
        problem ? { message: problem.message, command: problem.command, ...action } : undefined
      }
      screenRef={live.screenRef}
      viewport={live.tab?.viewport}
      action={live.action}
      name={name}
      onNavigate={(url) => live.send({ type: 'navigate', url })}
      onHistory={(history) => live.send({ type: 'history', action: history })}
      onInput={(input) => live.send(input)}
      onTakeOver={() => live.send({ type: 'control', to: 'user' })}
      onHandBack={() => live.send({ type: 'control', to: 'agent' })}
      onFit={fit}
      onClose={onClose}
    />
  );
}
