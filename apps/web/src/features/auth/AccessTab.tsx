import { SettingsAdvanced, Stack, toast } from '@conch/nacre';
import { useEffect, useMemo, useRef } from 'react';

import { useUi } from '../../app/ui';
import { OtherAppsTab } from '../otherapps/OtherAppsTab';
import { OTHER_APPS_FOCUS } from '../settings/paths';
import { useAdvanced } from '../settings/useAdvanced';
import { reveal, useAccess, type Focus } from './access';
import { DevicesTab } from './DevicesTab';
import { ADD_DEVICE_FOCUS, KEYS_FOCUS, PASSKEYS_FOCUS, SIGN_IN_FOCUS } from './focus';
import { PasskeysSection, SignInSection, type SignInPlace } from './SignInSections';
import { useVerify } from './useVerify';

/** The parts of Access that ⌘K or a checkup fix ask for by name. */
const ASKED: Record<string, SignInPlace> = {
  [SIGN_IN_FOCUS]: 'sign-in',
  [KEYS_FOCUS]: 'keys',
  [PASSKEYS_FOCUS]: 'passkeys',
};

/**
 * Settings → Access: every way into Conch, in one place — how you sign in
 * (a password, access keys), your passkeys, the devices signed in and your
 * phone, and, under Advanced, the other apps on this computer that use Conch
 * (ADR 0073). Security keeps the checkup; this is who gets in, and how.
 */
export function AccessTab() {
  const access = useAccess();
  const { guard, dialog } = useVerify(access.data?.method ?? 'none');
  const settingsFocus = useUi((s) => s.settingsFocus);
  const openSettings = useUi((s) => s.openSettings);
  // Other apps pairing is for the few: under Advanced, open when asked for by name.
  const [advanced, setAdvanced] = useAdvanced(OTHER_APPS_FOCUS);
  const others = useRef<HTMLDivElement>(null);
  const method = access.data?.method;
  // "Add your phone" with no sign-in yet: a phone signs in with a password, so
  // that comes first, and the code for the phone follows by itself once it's set.
  const signInFirst = settingsFocus === ADD_DEVICE_FOCUS && method === 'none';

  // Opened to a part of it (⌘K's "Passkeys", a checkup fix's "Choose a password"):
  // the part brings itself into view once it's drawn, and says it's done.
  const asked: SignInPlace | undefined = !method
    ? undefined
    : signInFirst
      ? 'sign-in'
      : settingsFocus
        ? ASKED[settingsFocus]
        : undefined;
  const focus = useMemo<Focus<SignInPlace> | undefined>(
    () =>
      asked
        ? { place: asked, done: () => useUi.setState({ settingsFocus: undefined }) }
        : undefined,
    [asked],
  );
  useEffect(() => {
    if (settingsFocus !== OTHER_APPS_FOCUS) return;
    useUi.setState({ settingsFocus: undefined });
    // Advanced is open already (useAdvanced): bring Other apps into view once it's drawn.
    const frame = requestAnimationFrame(() => reveal(others.current, undefined));
    return () => cancelAnimationFrame(frame);
  }, [settingsFocus]);

  const addAfterSignIn = useRef(false);
  useEffect(() => {
    if (!signInFirst) return;
    addAfterSignIn.current = true;
    toast('Your phone signs in with a password. Choose one here, and its code comes next.');
  }, [signInFirst]);
  useEffect(() => {
    if (!addAfterSignIn.current || !method || method === 'none') return;
    addAfterSignIn.current = false;
    openSettings('access', ADD_DEVICE_FOCUS);
  }, [method, openSettings]);

  return (
    <Stack gap={8}>
      {access.data && (
        <>
          <SignInSection access={access.data} guard={guard} focus={focus} />
          <PasskeysSection access={access.data} guard={guard} focus={focus} />
        </>
      )}
      {/* Loading and a failure to load are said once, here. */}
      <DevicesTab />
      <SettingsAdvanced open={advanced} onOpenChange={setAdvanced}>
        <div ref={others}>
          <OtherAppsTab />
        </div>
      </SettingsAdvanced>
      {dialog}
    </Stack>
  );
}
