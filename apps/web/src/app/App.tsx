import { NacreProvider, Toaster } from '@conch/nacre';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter } from 'react-router';

import { AuthGate } from '../features/auth/AuthGate';
import { LiveProvider } from '../live/LiveProvider';
import { Navigator } from './navigation';
import { Root } from './Root';

export function App() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <NacreProvider storageKey="conch.theme">
      <QueryClientProvider client={client}>
        <AuthGate>
          <LiveProvider>
            <BrowserRouter>
              <Navigator />
              <Root />
            </BrowserRouter>
          </LiveProvider>
        </AuthGate>
        <Toaster />
      </QueryClientProvider>
    </NacreProvider>
  );
}
