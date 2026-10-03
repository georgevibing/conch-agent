import '@conch/nacre/styles.css';
import './app/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App, preloadPage } from './app/App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// The page was built ahead of time, so its words are already showing. Its code comes
// first, then the live page takes its place in one go, with no "Opening the page" between.
void preloadPage(window.location.pathname)
  .catch(() => undefined)
  .then(() =>
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
