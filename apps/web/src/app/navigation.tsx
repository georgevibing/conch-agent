import { useLayoutEffect } from 'react';
import {
  useLocation,
  useNavigate,
  type Location,
  type NavigateFunction,
  type NavigateOptions,
} from 'react-router';

let router: { navigate: NavigateFunction; location: Location } | undefined;

/**
 * Lets what lives outside a page — the ui store, a toast, a notification —
 * move the app the way a link would. Mounted once inside the router and
 * outside its routes, so it always sees the real address.
 */
export function Navigator() {
  const navigate = useNavigate();
  const location = useLocation();
  useLayoutEffect(() => {
    const mine = { navigate, location };
    router = mine;
    return () => {
      if (router === mine) router = undefined;
    };
  }, [navigate, location]);
  return null;
}

/** Go somewhere in the app. False when there's no router yet to take it. */
export function go(to: string, options?: NavigateOptions): boolean {
  if (!router) return false;
  void router.navigate(to, options);
  // Where it's going is where it is, before the router has drawn it: two
  // moves in one press (a tab's mousedown, then its focus) see the first.
  const { pathname, search, hash } = new URL(to, 'http://conch.invalid');
  router = {
    ...router,
    location: { pathname, search, hash, state: options?.state ?? null, key: 'going' },
  };
  return true;
}

/** Where the app is now (or is on its way to). */
export function here(): Location | undefined {
  return router?.location;
}
