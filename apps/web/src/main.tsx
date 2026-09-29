import '@conch/nacre/styles.css';

import { NacreProvider } from '@conch/nacre';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <NacreProvider storageKey="conch.theme">
      <App />
    </NacreProvider>
  </StrictMode>,
);
