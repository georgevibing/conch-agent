import { Breadcrumb } from '@conch/nacre';
import { createContext, useContext, useLayoutEffect } from 'react';
import { Link } from 'react-router';

/**
 * One place in a trail. The last is the page you're on; each before it is a
 * step back to it: an address (`to`), or something to do (`onSelect`).
 */
export interface Crumb {
  label: string;
  to?: string;
  onSelect?: () => void;
}

/**
 * Where you are, as one trail (NACRE.md § Where you are): Apps › Gmail,
 * Skills › Discover › PDF tools, Settings' Memory › What Conch knows. The
 * places above are steps back; the page you're on is read as the current
 * page, and can take the focus when you arrive (`tabIndex={-1}`).
 */
export function Trail({
  crumbs,
  currentId,
  className,
}: {
  crumbs: readonly Crumb[];
  /** The page's name, for a panel it labels. */
  currentId?: string;
  className?: string;
}) {
  const last = crumbs.length - 1;
  return (
    <Breadcrumb className={className}>
      {crumbs.map((crumb, i) =>
        i === last ? (
          <Breadcrumb.Item key={i} current id={currentId} tabIndex={-1}>
            {crumb.label}
          </Breadcrumb.Item>
        ) : crumb.to !== undefined ? (
          <Breadcrumb.Item key={i} asChild>
            <Link to={crumb.to} title={crumb.label}>
              {crumb.label}
            </Link>
          </Breadcrumb.Item>
        ) : (
          <Breadcrumb.Item key={i} onClick={crumb.onSelect}>
            {crumb.label}
          </Breadcrumb.Item>
        ),
      )}
    </Breadcrumb>
  );
}

/** A page's trail, as an address-only list the Shell's header can draw. */
export type PageTrail = readonly { label: string; to?: string }[];

const TrailContext = createContext<((trail: PageTrail | null) => void) | null>(null);

/** The Shell lends its header to the page inside it. */
export const PageTrailProvider = TrailContext.Provider;

/**
 * Says where a page inside a place is — `[{ label: 'Apps', to: '/apps' },
 * { label: 'Gmail' }]` — so the window's header shows it as the trail, in
 * place of the place's name, on every width. Never a back button of the
 * page's own. `null` (still loading, or a page with nothing above it): the
 * header names the place. Outside the Shell (a test of one page) it does nothing.
 */
export function usePageTrail(trail: PageTrail | null) {
  const set = useContext(TrailContext);
  // By value, so a page drawn again with the same names doesn't redraw the header.
  const key = trail && JSON.stringify(trail.map(({ label, to }) => ({ label, to })));
  useLayoutEffect(() => {
    if (!set || key === null) return;
    set(JSON.parse(key) as PageTrail);
    return () => set(null);
  }, [set, key]);
}
