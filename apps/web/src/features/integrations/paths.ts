/**
 * Where Apps lives (ADR 0052). The page used to be "Integrations" at
 * `/integrations`, and chat apps had their own page at `/channels`: both
 * still lead here (`Root.tsx`), so old links, sign-in returns and ⌘K keep
 * working. Internal names stay "integration" where renaming would be churn.
 */
export const APPS_PATH = '/apps';

/** Things the assistant made and you pinned live at `/apps/a_…` (ADR 0034): never an app. */
export const isPinnedId = (id: string | undefined) => Boolean(id && /^a_/.test(id));

/** An app's page: an integration's id, or a catalog app's (`slack`, `1password`). */
export const appPath = (id: string) => `${APPS_PATH}/${encodeURIComponent(id)}`;

/** The connect dialog for a catalog app, over the Apps page. */
export const connectPath = (catalogId: string) =>
  `${APPS_PATH}?connect=${encodeURIComponent(catalogId)}`;

/** Finish setting up one you already added (a card's "Finish setup"). */
export const setupPath = (id: string) => `${APPS_PATH}?setup=${encodeURIComponent(id)}`;

/** The apps you can talk to your assistant from: what used to be Channels. */
export const TALK_PATH = `${APPS_PATH}?show=talk`;

/** Where an old address goes now, keeping what it asked for (`?connect=`, `?result=`…). */
export function newHome(pathname: string, search: string): string | undefined {
  if (pathname === '/integrations' || pathname === '/integrations/') return `${APPS_PATH}${search}`;
  const app = /^\/integrations\/([^/]+)\/?$/.exec(pathname)?.[1];
  // `/integrations/done` is the sign-in window's own page, handled before the routes.
  if (app && app !== 'done') return `${APPS_PATH}/${app}${search}`;
  if (pathname === '/channels' || pathname === '/channels/') {
    const params = new URLSearchParams(search);
    params.set('show', 'talk');
    return `${APPS_PATH}?${params.toString()}`;
  }
  return undefined;
}
