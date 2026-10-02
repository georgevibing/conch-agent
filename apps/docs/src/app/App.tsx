import { NacreProvider, Pearl } from '@conch/nacre';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';

import { Landing } from '../landing/Landing';
import { Layout } from '../shell/Layout';
import styles from './App.module.css';

// The front page comes alone: the guides (every word of them) arrive when someone opens one.
const Home = lazy(() => import('../home/Home').then((module) => ({ default: module.Home })));
const DocPage = lazy(() =>
  import('../pages/DocPage').then((module) => ({ default: module.DocPage })),
);

function Arriving() {
  return (
    <div className={styles.arriving}>
      <Pearl size="lg" state="thinking" label="Opening the page" />
    </div>
  );
}

/** Where the site is served from: `/`, or a folder (`CONCH_DOCS_BASE`). */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export function App() {
  return (
    <NacreProvider storageKey="conch.docs.theme">
      <BrowserRouter basename={BASE}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Landing />} />
            <Route
              path="docs"
              element={
                <Suspense fallback={<Arriving />}>
                  <Home />
                </Suspense>
              }
            />
            <Route
              path="*"
              element={
                <Suspense fallback={<Arriving />}>
                  <DocPage />
                </Suspense>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </NacreProvider>
  );
}
