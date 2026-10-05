import { NacreProvider, Pearl } from '@conch/nacre';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';

import { Landing } from '../landing/Landing';
import { DEVELOPMENT } from '../site/config';
import { Layout } from '../shell/Layout';
import styles from './App.module.css';

/**
 * A page whose code comes when it's first opened, or ahead of time with
 * `preload()`: once it's here it draws straight away, with no pause.
 */
function onDemand(load: () => Promise<ComponentType>) {
  let ready: ComponentType | undefined;
  const preload = () => load().then((component) => (ready = component));
  const Later = lazy(() => preload().then((component) => ({ default: component })));
  function OnDemand() {
    const Ready = ready;
    return Ready ? <Ready /> : <Later />;
  }
  return Object.assign(OnDemand, { preload });
}

// The front page comes alone: the guides (every word of them) arrive when someone opens one.
const Home = onDemand(() => import('../home/Home').then((module) => module.Home));
const Releases = onDemand(() => import('../releases/Releases').then((module) => module.Releases));
const DocPage = onDemand(() => import('../pages/DocPage').then((module) => module.DocPage));

function Arriving() {
  return (
    <div className={styles.arriving}>
      <Pearl size="lg" state="thinking" label="Opening the page" />
    </div>
  );
}

/** Where the site is served from: `/`, or a folder (`CONCH_DOCS_BASE`). */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** The page at an address, from the top of the site: `/`, `/docs`, `/start/install`. */
const pageFor = (path: string) =>
  path.replace(/\/+$/, '') === '/releases'
    ? Releases
    : path === '/'
      ? DEVELOPMENT
        ? Home
        : undefined
      : path.replace(/\/+$/, '') === '/docs'
        ? Home
        : DocPage;

/**
 * The code for the page at `pathname`, fetched before the site first draws: a
 * page built ahead of time is then replaced by the same page in one go.
 */
export function preloadPage(pathname: string): Promise<unknown> {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) || '/' : pathname;
  return pageFor(path)?.preload() ?? Promise.resolve();
}

/** Every page of the site, whichever router holds the address. */
export function SiteRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={
            DEVELOPMENT ? (
              <Suspense fallback={<Arriving />}>
                <Home />
              </Suspense>
            ) : (
              <Landing />
            )
          }
        />
        <Route
          path="releases"
          element={
            <Suspense fallback={<Arriving />}>
              <Releases />
            </Suspense>
          }
        />
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
  );
}

/** The theme every page shares; the browser and the build each bring their router. */
export function Site({ children }: { children: ReactNode }) {
  return <NacreProvider storageKey="conch.docs.theme">{children}</NacreProvider>;
}

export function App() {
  return (
    <Site>
      <BrowserRouter basename={BASE}>
        <SiteRoutes />
      </BrowserRouter>
    </Site>
  );
}
