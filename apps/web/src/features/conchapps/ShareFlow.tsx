import type { ConchAppSource, PublishState } from '@conch/protocol';
import { ShareSteps, toast } from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { errorText } from '../integrations/queries';
import { GetIt } from '../setup/GetIt';
import { needKeys, needsApi } from '../setup/api';
import { conchAppsApi, saveBlob } from './api';
import { conchAppKeys, usePublishState } from './queries';

/** Where an app came from, to pass on: a GitHub repository or the link it was added from. */
export function originOf(source: ConchAppSource): string | undefined {
  if (source.kind === 'github') return source.url;
  if (source.kind === 'link') return source.url;
  return undefined;
}

/**
 * Sharing an app (ADR 0061), on its page and in a chat's card alike:
 * **Publish on GitHub** (installing GitHub's program and signing in on the
 * way, then carrying on by itself) or **Save as a file**. Both sign with the
 * person's key, so both ask that it's them. An app someone else made can't
 * be published by you: it offers where it came from, and the file.
 */
export function ShareFlow({
  appId,
  name,
  source,
  ...props
}: {
  appId: string;
  name: string;
  /** Where it came from; undefined while it isn't known yet (it's treated as yours). */
  source?: ConchAppSource;
} & Omit<ComponentProps<typeof ShareSteps>, 'name' | 'appId' | 'state'>) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const mine = !source || source.kind === 'made';
  const { data } = usePublishState(appId, mine);
  const [failed, setFailed] = useState<string>();
  const [saving, setSaving] = useState(false);
  const state: PublishState = failed
    ? { state: 'failed', message: failed }
    : (data ?? { state: 'idle' });

  const publish = async () => {
    setFailed(undefined);
    try {
      await guard(async () => {
        const next = await conchAppsApi.publish(appId);
        client.setQueryData(conchAppKeys.publish(appId), next);
      });
    } catch (error) {
      setFailed(errorText(error, `${name} wasn’t published. Try again in a moment.`));
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await guard(async () => {
        const file = await conchAppsApi.exportFile(appId);
        saveBlob(file.name, file.blob);
        toast.success(`Saved ${file.name}`, { description: 'Send it any way you like.' });
      });
    } catch (error) {
      toast.error(errorText(error, 'It wasn’t saved. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  // GitHub's program arrived (installed here, or by hand): carry on publishing, once.
  const need = state.state === 'needs-program' ? state.need : undefined;
  const { data: readiness } = useQuery({
    queryKey: needKeys.one(need ?? ''),
    queryFn: () => needsApi.get(need ?? ''),
    enabled: Boolean(need),
    refetchOnWindowFocus: 'always',
  });
  const carried = useRef(false);
  const landed = Boolean(need && readiness?.ready);
  const carryOn = useEffectEvent(() => void publish());
  useEffect(() => {
    if (!landed || carried.current) return;
    carried.current = true;
    carryOn();
  }, [landed]);

  return (
    <>
      <ShareSteps
        name={name}
        appId={appId}
        state={state}
        onPublish={mine ? () => void publish() : undefined}
        onSaveFile={() => void save()}
        saving={saving}
        getIt={need ? <GetIt needId={need} /> : undefined}
        {...(!mine && source && { elsewhere: { url: originOf(source) } })}
        {...props}
      />
      {dialog}
    </>
  );
}
