import { NacreProvider, Toaster } from '@conch/nacre';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter } from 'react-router';

import { LiveProvider } from '../live/LiveProvider';
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
        <LiveProvider>
          <BrowserRouter>
            <Root />
          </BrowserRouter>
        </LiveProvider>
        <Toaster />
      </QueryClientProvider>
    </NacreProvider>
  );
}
