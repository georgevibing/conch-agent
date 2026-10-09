import type { CheckupFix, CheckupPlace } from '@conch/protocol';
import {
  Callout,
  SecurityCheckup,
  SettingsAdvanced,
  Skeleton,
  Stack,
  toast,
  type CheckItem,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError, api } from '../../api/client';
import { keys } from '../../api/queries';
import { useUi } from '../../app/ui';
import { OTHER_APPS_FOCUS } from '../settings/paths';
import { Section } from '../settings/Section';
import { useAdvanced } from '../settings/useAdvanced';
import { AddressSection } from './AddressSection';
import { fail, useAccess, useApply, type Focus as AccessFocus, type Guard } from './access';
import { ADDRESS_FOCUS, DEVICES_FOCUS, REACH_FOCUS } from './focus';
import { useVerify } from './useVerify';
import { LIVE_DATA_FOCUS, LiveDataSection } from '../artifacts/LiveDataSection';
import { SafetySection } from '../safety/SafetySection';
import { WhereWorkRuns } from '../workplaces/WhereWorkRuns';
import { WORKPLACES_FOCUSES } from '../workplaces/words';

/** A part of this tab a checkup fix can bring you to; the ways in are on Access. */
type Place = Extract<CheckupPlace, 'live-data' | 'address'>;
type Focus = AccessFocus<Place>;

// ── Tab ────────────────────────────────────────────────────────────────────

/**
 * Each checkup finding's one fix. `open` goes where the decision is made;
 * `act` asks the gateway to make the change (only ever towards asking, off
 * or private), confirming it's you first wherever that setting's own route
 * would. Once it works the finding leaves the list and a quiet toast says
 * what changed.
 */
function useCheckupFix(guard: Guard) {
  const client = useQueryClient();
  const apply = useApply();
  const openSettings = useUi((s) => s.openSettings);
  const [focus, setFocus] = useState<Focus>();

  const run = (fix: CheckupFix): Promise<unknown> | undefined => {
    if (fix.kind === 'open') {
      // Which provider new chats start with is Providers (their mode is the composer's).
      if (fix.place === 'models') openSettings('providers');
      else if (fix.place === 'dashboards') openSettings('dashboards');
      // The ways in — devices, your phone, passkeys, sign-in, keys, other apps — are Access.
      else if (fix.place === 'other-apps') openSettings('access', OTHER_APPS_FOCUS);
      else if (fix.place === 'devices') openSettings('access', DEVICES_FOCUS);
      else if (fix.place === 'reach') openSettings('access', REACH_FOCUS);
      else if (fix.place === 'sign-in' || fix.place === 'keys' || fix.place === 'passkeys')
        openSettings('access', fix.place);
      else if (fix.place === 'channels') {
        // A page, not a part of Settings: going there leaves Settings.
        window.dispatchEvent(new CustomEvent('conch:navigate', { detail: '/apps?show=talk' }));
      } else setFocus({ place: fix.place, done: () => setFocus(undefined) });
      return undefined;
    }
    return guard(async () => {
      const { done, access } = await api.fixCheckup(fix.action);
      // A refetch that started before the fix (say, after confirming it's you) is already stale.
      await client.cancelQueries({ queryKey: keys.access });
      apply(access);
      // "Ask first" changes the mode new chats start in.
      void client.invalidateQueries({ queryKey: keys.state });
      toast.success(done);
    }).catch(fail);
  };
  const focusOn = (place: Place) => setFocus({ place, done: () => setFocus(undefined) });
  return { run, focus, focusOn };
}

/**
 * Settings → Security: the checkup, and what almost nobody changes (safety,
 * where work runs, live data, your own address) under Advanced. The ways in
 * — sign-in, passkeys, devices — are Settings → Access.
 */
export function SecurityTab() {
  const access = useAccess();
  const { guard, dialog } = useVerify(access.data?.method ?? 'none');
  const fix = useCheckupFix(guard);
  // The checks that are already right, and the two ways out of this computer,
  // wait under Advanced — and open by themselves when ⌘K or a fix points there.
  const [advanced, setAdvanced] = useAdvanced(
    LIVE_DATA_FOCUS,
    ADDRESS_FOCUS,
    ...WORKPLACES_FOCUSES,
  );
  const asked = fix.focus?.place;
  useEffect(() => {
    if (asked === 'live-data' || asked === 'address') setAdvanced(true);
  }, [asked, setAdvanced]);
  // Opened to a part of the tab (⌘K's "Live data in pages", a fix's "Your address").
  const settingsFocus = useUi((s) => s.settingsFocus);
  const loaded = Boolean(access.data);
  const { focusOn } = fix;
  useEffect(() => {
    if (settingsFocus !== LIVE_DATA_FOCUS || !loaded) return;
    useUi.setState({ settingsFocus: undefined });
    focusOn('live-data');
  }, [settingsFocus, loaded, focusOn]);
  useEffect(() => {
    if (settingsFocus !== ADDRESS_FOCUS || !loaded) return;
    useUi.setState({ settingsFocus: undefined });
    focusOn('address');
  }, [settingsFocus, loaded, focusOn]);

  if (access.isPending)
    return (
      <Stack gap={4}>
        <Skeleton shape="block" height={120} />
        <Skeleton shape="block" height={220} />
      </Stack>
    );
  if (access.isError) {
    // A gateway started before this version doesn't know these routes yet.
    const stale = access.error instanceof ApiError && access.error.status === 404;
    return stale ? (
      <Callout tone="info" title="Restart Conch to finish updating">
        The page is up to date, but the Conch gateway on this computer is still running the previous
        version. Stop it (Ctrl+C in its terminal) and run <code>pnpm start</code> again.
      </Callout>
    ) : (
      <Callout tone="danger" title="Couldn’t load security settings">
        {access.error instanceof ApiError ? access.error.message : 'Try again in a moment.'}
      </Callout>
    );
  }

  const data = access.data;
  const items: CheckItem[] = data.checkup.map(({ fix: wire, ...item }) => ({
    ...item,
    ...(wire && { fix: { label: wire.label, kind: wire.kind, onFix: () => fix.run(wire) } }),
  }));

  return (
    <Stack gap={8}>
      <Section title="Security" description="Keep Conch — and this computer — safe.">
        <SecurityCheckup items={items} />
      </Section>
      <SettingsAdvanced open={advanced} onOpenChange={setAdvanced}>
        <SafetySection />
        <WhereWorkRuns />
        <LiveDataSection focus={fix.focus} />
        <AddressSection guard={guard} focus={fix.focus} />
      </SettingsAdvanced>
      {dialog}
    </Stack>
  );
}
