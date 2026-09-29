import { Button, Heading, Pearl, Stack, Text } from '@conch/nacre';
import { RotateCw } from 'lucide-react';
import { Route, Routes } from 'react-router';

import { useAppState } from '../api/queries';
import { OAuthDone } from '../features/integrations/OAuthDone';
import { ProviderDone } from '../features/providers/ProviderDone';
import { Onboarding } from '../features/onboarding/Onboarding';
import { Shell } from './Shell';
import styles from './Root.module.css';

export function Root() {
  const state = useAppState();

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
    <Routes>
      <Route path="/" element={<Shell />} />
      <Route path="/c/:conversationId" element={<Shell />} />
      <Route path="/routines" element={<Shell />} />
      <Route path="/routines/:routineId" element={<Shell />} />
      <Route path="/integrations" element={<Shell />} />
      <Route path="/integrations/:integrationId" element={<Shell />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}
