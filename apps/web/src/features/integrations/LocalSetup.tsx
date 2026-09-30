import type { CatalogEntry, Integration, Need, Readiness } from '@conch/protocol';
import { Button, SetupChecklist, type SetupStepState } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Download, ExternalLink, Monitor } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { integrationsApi } from './api';
import styles from './Integrations.module.css';
import { errorText, integrationKeys, putIntegration, useNeeds } from './queries';

const stepState: Record<Need['state'], SetupStepState> = {
  ready: 'done',
  missing: 'current',
  installing: 'working',
  failed: 'failed',
  unsupported: 'unavailable',
};

/** A missing need, in one sentence: what's wrong, or what Conch will do about it. */
function describe(need: Need): string | undefined {
  if (need.message) return need.message;
  if (need.state !== 'missing') return undefined;
  if (need.install) return 'Conch can install it for you. It takes a minute or two.';
  if (need.download) return 'Get it from its website. Conch notices by itself once it’s there.';
  return undefined;
}

export interface LocalSetup {
  /** Everything it needs is on this computer. */
  ready: boolean;
  /** The list of what it needs, filling in by itself. */
  checklist: ReactNode;
  /** The one button while something's missing; unset once it's all here. */
  primary?: ReactNode;
  error?: string;
  /** "Confirm it's you" before installing, when the sign-in is old. */
  dialog: ReactNode;
}

/**
 * Setting up an app that runs on this computer (AGENTS.md agreement 11): what
 * it needs, with one button that gets the next thing — Conch installs it, or
 * opens where you get it — and carries on by itself once it's there. Nothing
 * here asks you to press "Try again".
 */
export function useLocalSetup(
  entry: CatalogEntry,
  current: Integration | undefined,
  /** Connect it, now that everything's here. */
  connect: () => void,
): LocalSetup {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const local = entry.local && entry.auth === 'none' && Boolean(entry.command);
  const { data: readiness } = useNeeds(entry.id, local);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  /** You pressed Install: connect as soon as it lands. */
  const carryOn = useRef(false);

  const needs = readiness?.needs ?? [];
  const ready = local ? (readiness?.ready ?? false) : true;
  const pending = needs.find((n) => n.state !== 'ready');
  const opener = needs.find((n) => n.openable);
  const put = (next: Readiness) => client.setQueryData(integrationKeys.needs(entry.id), next);
  const recheck = (integration: Integration) =>
    void integrationsApi
      .check(integration.id)
      .then((i) => putIntegration(client, i))
      .catch(() => undefined);

  // Everything arrived (Conch installed it, or you did): carry on without being asked.
  const seen = useRef<boolean>(undefined);
  useEffect(() => {
    if (!readiness) return;
    const before = seen.current;
    seen.current = readiness.ready;
    if (before !== false || !readiness.ready) return;
    if (current) recheck(current);
    else if (carryOn.current) connect();
    carryOn.current = false;
    // Only the moment it becomes ready matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readiness?.ready]);

  // Everything's here but switched off in its app: look again whenever you come back.
  const switchedOff = ready && current?.health.action === 'setup';
  useEffect(() => {
    if (!switchedOff || !current) return;
    const again = () => {
      if (document.visibilityState === 'visible') recheck(current);
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchedOff, current?.id]);

  const install = async (need: Need) => {
    setError(undefined);
    setStarting(true);
    carryOn.current = true;
    try {
      const ok = await guard(async () => put(await integrationsApi.installNeed(entry.id, need.id)));
      if (!ok) carryOn.current = false;
    } catch (e) {
      carryOn.current = false;
      setError(errorText(e, 'Couldn’t start installing it.'));
    } finally {
      setStarting(false);
    }
  };

  const open = async (need: Need) => {
    setError(undefined);
    try {
      put(await integrationsApi.openNeed(entry.id, need.id));
    } catch (e) {
      setError(errorText(e, 'Couldn’t open it.'));
    }
  };

  const openButton = opener && (
    <Button
      size="sm"
      variant="surface"
      trailingIcon={<ExternalLink />}
      onClick={() => void open(opener)}
    >
      Open {opener.short}
    </Button>
  );

  const switchState: SetupStepState = !ready
    ? 'waiting'
    : current?.health.state === 'ok'
      ? 'done'
      : 'current';

  const checklist = local && (
    <div className={styles.localSetup}>
      <SetupChecklist aria-label={`What ${entry.name} needs`}>
        {needs.map((need) => {
          const isNext = need === pending;
          return (
            <SetupChecklist.Step
              key={need.id}
              state={need.state === 'missing' && !isNext ? 'waiting' : stepState[need.state]}
              title={need.name}
              note="Ready"
              description={describe(need)}
              progress={
                need.progress && { value: need.progress.percent, label: need.progress.label }
              }
              action={
                isNext && need.state === 'failed' && need.download ? (
                  <Button asChild size="sm" variant="ghost" trailingIcon={<ArrowUpRight />}>
                    <a href={need.download} target="_blank" rel="noopener noreferrer">
                      Get {need.short} from its website
                    </a>
                  </Button>
                ) : isNext && !need.install && !need.download && need.openable ? (
                  openButton
                ) : undefined
              }
            />
          );
        })}
        {entry.steps.length > 0 && (
          <SetupChecklist.Step
            state={switchState}
            title="Turn it on"
            note="On"
            description={
              switchState === 'current' && (
                <ol>
                  {entry.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )
            }
            action={switchState === 'current' ? openButton : undefined}
          />
        )}
      </SetupChecklist>
      <p className={styles.runsHere}>
        <Monitor aria-hidden />
        <span>
          Runs on this computer, as you: <code className={styles.command}>{entry.command}</code>
        </span>
      </p>
      {pending?.install && pending.state !== 'installing' && (
        <p className={styles.runsHere}>
          <Download aria-hidden />
          <span className={styles.oneLine}>
            Installs with{' '}
            <code className={styles.command} title={pending.install.command}>
              {pending.install.command}
            </code>
          </span>
        </p>
      )}
    </div>
  );

  let primary: ReactNode;
  if (local && !ready && pending) {
    if (pending.state === 'installing')
      primary = (
        <Button size="lg" block loading disabled>
          Installing {pending.short}…
        </Button>
      );
    else if (pending.install)
      primary = (
        <Button
          size="lg"
          block
          leadingIcon={<Download />}
          loading={starting}
          onClick={() => void install(pending)}
        >
          {pending.state === 'failed' ? 'Try installing again' : pending.install.label}
        </Button>
      );
    else if (pending.download)
      primary = (
        <Button asChild size="lg" block trailingIcon={<ArrowUpRight />}>
          <a href={pending.download} target="_blank" rel="noopener noreferrer">
            Get {pending.short}
          </a>
        </Button>
      );
    else if (pending.openable && opener)
      primary = (
        <Button size="lg" block trailingIcon={<ExternalLink />} onClick={() => void open(opener)}>
          Open {opener.short}
        </Button>
      );
    else
      primary = (
        <Button size="lg" block disabled>
          Not available on this computer
        </Button>
      );
  } else if (local && !readiness) {
    primary = (
      <Button size="lg" block loading disabled>
        Looking for what it needs…
      </Button>
    );
  }

  return { ready, checklist, primary, error, dialog };
}
