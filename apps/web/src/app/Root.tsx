import { Button, Heading, Pearl, Stack, Text } from '@conch/nacre';
import { RotateCw } from 'lucide-react';
import { Navigate, Route, Routes, useLocation } from 'react-router';

import { useAppState } from '../api/queries';
import { OAuthDone } from '../features/integrations/OAuthDone';
import { APPS_PATH, newHome } from '../features/integrations/paths';
import { ProviderDone } from '../features/providers/ProviderDone';
import { Onboarding } from '../features/onboarding/Onboarding';
import { behindOf, settingsAt } from '../features/settings/paths';
import { Settings } from '../features/settings/Settings';
import { Shell } from './Shell';
import styles from './Root.module.css';

export function Root() {
  const state = useAppState();
  const location = useLocation();
  // Settings opens over the page you were on, which stays as it was behind it.
  const behind = settingsAt(location.pathname) ? (behindOf(location) ?? '/') : undefined;

  if (state.isPending) {
    return (
      <div className={styles.center} aria-busy>
        <Pearl size="lg" state="thinking" label="Starting Conch" />
      </div>
    );
  }

  if (state.isError) {
    return (
      <div className={styles.center}>
        <Stack gap={4} align="center" className={styles.offline}>
          <Pearl size="lg" state="error" label={null} />
          <Heading level={1} display size="3xl" align="center">
            Conch isn’t running
          </Heading>
          <Text tone="muted" align="center">
            The web page is here, but the Conch gateway on your computer isn’t answering. Start it
            from the Conch folder with <code>pnpm start</code>, then try again.
          </Text>
          <Button variant="surface" leadingIcon={<RotateCw />} onClick={() => void state.refetch()}>
            Try again
          </Button>
        </Stack>
      </div>
    );
  }

  // The sign-in windows: pages of their own, without the app around them.
  if (window.location.pathname === '/integrations/done') return <OAuthDone />;
  if (window.location.pathname === '/providers/done') return <ProviderDone />;

  if (!state.data.onboarded) return <Onboarding />;

  return (
    <>
      <Routes location={behind ?? location}>
        <Route path="/" element={<Shell />} />
        <Route path="/c/:conversationId" element={<Shell />} />
        <Route path="/tasks" element={<Shell />} />
        <Route path="/routines" element={<Shell />} />
        <Route path="/routines/:routineId" element={<Shell />} />
        <Route path="/skills" element={<Shell />} />
        <Route path="/skills/new" element={<Shell />} />
        {/* Discover (ADR 0074): skills people share, and one of them, read before it's added. */}
        <Route path="/skills/discover" element={<Shell />} />
        <Route path="/skills/discover/:listingId" element={<Shell />} />
        <Route path="/skills/:skillId" element={<Shell />} />
        <Route path="/apps" element={<Shell />} />
        <Route path="/apps/:appId" element={<Shell />} />
        {/* A Conch app's page, on a page of its own (ADR 0061). */}
        <Route path="/apps/:appId/:pageId" element={<Shell />} />
        {/* Integrations and Channels are Apps now (ADR 0052): old links still arrive. */}
        <Route path="/integrations" element={<MovedToApps />} />
        <Route path="/integrations/:integrationId" element={<MovedToApps />} />
        <Route path="/channels" element={<MovedToApps />} />
        <Route path="/channels/new/:channelKind" element={<Shell />} />
        <Route path="/channels/:channelId" element={<Shell />} />
        <Route path="/passwords" element={<Shell />} />
        <Route path="/activity" element={<Shell />} />
        <Route path="/memory" element={<Shell />} />
        <Route path="/archived" element={<Shell />} />
        <Route path="/passwords/:itemId" element={<Shell />} />
        <Route path="*" element={<Shell />} />
      </Routes>
      <Settings />
    </>
  );
}

/** An address from before Apps: the same place there, with what it asked for. */
export function MovedToApps() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`${newHome(pathname, search) ?? APPS_PATH}${hash}`} replace />;
}
