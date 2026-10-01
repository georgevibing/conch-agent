import { NacreProvider } from '@conch/nacre';
import { BrowserRouter, Route, Routes } from 'react-router';

import { Home } from '../home/Home';
import { DocPage } from '../pages/DocPage';
import { Layout } from '../shell/Layout';

/** Where the site is served from: `/`, or a folder (`CONCH_DOCS_BASE`). */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export function App() {
  return (
    <NacreProvider storageKey="conch.docs.theme">
      <BrowserRouter basename={BASE}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="*" element={<DocPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </NacreProvider>
  );
}
