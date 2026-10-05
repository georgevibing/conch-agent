import { Button, ReleaseNotes, UpdateDialog } from '@conch/nacre';
import { Download, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useUi } from '../../app/ui';
import { followRestart, useLookWhenBack, useUpdateActions, useUpdates } from './queries';
import { ARRIVED, noteItems, short, updateView, type UpdateOffer } from './view';

/**
 * Conch's own update, from anywhere: the dialog the sidebar's chip, the
 * banner, ⌘K and Settings open. It carries the update from "what it brings"
 * to "you're on the new Conch", and follows Conch through its restart.
 */
export function UpdateDialogHost() {
  const { data: status } = useUpdates();
  // A new Conch shows up while you're here, or as soon as you come back.
  useLookWhenBack();
  const actions = useUpdateActions();
  const how = useUi((s) => s.updateDialog);
  const slow = useUi((s) => s.restartSlow);
  const [restartNote, setRestartNote] = useState<string>();

  // Back on the new version: say so, once.
  useEffect(() => {
    let arrived = false;
    try {
      arrived = sessionStorage.getItem(ARRIVED) === '1';
      sessionStorage.removeItem(ARRIVED);
    } catch {
      // Private windows: the update simply isn't announced.
    }
    if (arrived) useUi.getState().openUpdate({ arrived: true });
  }, []);

  // Wherever it was started, the page follows Conch through its restart.
  useEffect(() => {
    if (status) followRestart(status);
  }, [status]);

  const start = () => actions.updateConch();

  // "Update" from the banner or Settings: begin at once, here, once.
  useEffect(() => {
    if (!how?.start || !status) return;
    useUi.setState({ updateDialog: { ...how, start: false } });
    if (!status.conch.running && status.conch.behind > 0 && !status.conch.blocked) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request
  }, [how, status]);

  if (!status) return actions.dialog;
  const view = updateView(status, { arrived: Boolean(how?.arrived) });
  const close = () => useUi.getState().closeUpdate();
  const notes =
    view.releases.length && (view.stage === 'ready' || view.stage === 'done') ? (
      <ReleaseNotes releases={noteItems(view.releases)} />
    ) : undefined;
  const latest = status.conch.latest;

  const button = (offer: UpdateOffer) => {
    switch (offer) {
      case 'later':
        return (
          <Button key={offer} variant="ghost" onClick={close}>
            {view.stage === 'updating' ? 'Keep working' : 'Later'}
          </Button>
        );
      case 'close':
        return (
          <Button key={offer} variant="ghost" onClick={close}>
            Close
          </Button>
        );
      case 'done':
        return (
          <Button key={offer} onClick={close}>
            Done
          </Button>
        );
      case 'update':
      case 'retry':
        return (
          <Button
            key={offer}
            leadingIcon={offer === 'retry' ? <RotateCcw /> : <RefreshCw />}
            loading={actions.pending === 'conch'}
            onClick={() => void start()}
          >
            {offer === 'retry' ? 'Try again' : 'Update now'}
          </Button>
        );
      case 'download':
        return (
          <Button key={offer} asChild leadingIcon={<Download />}>
            <a href={view.download} target="_blank" rel="noopener noreferrer">
              Download Conch {latest ? short(latest.version) : ''}
            </a>
          </Button>
        );
      case 'restart':
        return (
          <Button
            key={offer}
            leadingIcon={<RotateCcw />}
            onClick={() => {
              setRestartNote(undefined);
              void actions.restart('Starting the new Conch').then(setRestartNote);
            }}
          >
            Restart now
          </Button>
        );
    }
  };

  const problem = actions.error ?? restartNote;
  return (
    <>
      <UpdateDialog
        open={Boolean(how)}
        onOpenChange={(open) => !open && close()}
        stage={view.stage}
        title={view.title}
        detail={view.detail}
        changes={view.changes}
        notes={notes}
        more={view.more}
        progress={view.progress}
        footnote={view.footnote}
        notice={view.notice ?? (problem ? { tone: 'warning', message: problem } : undefined)}
        slow={
          view.stage === 'restarting' && slow
            ? 'This is taking longer than usual. If Conch doesn’t come back, run pnpm start in its folder.'
            : undefined
        }
        action={view.offers.length ? view.offers.map(button) : undefined}
      />
      {actions.dialog}
    </>
  );
}
