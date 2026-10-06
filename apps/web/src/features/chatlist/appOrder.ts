import { useCallback, useState } from 'react';

import type { AppDockItem } from '@conch/nacre';

const RECENT_KEY = 'conch.appsRecent';
/** Enough to fill the sidebar's row several times over; the rest is in the folder. */
const RECENT_MAX = 24;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw === null) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((v) => typeof v === 'string')
      ? (value as string[])
      : [];
  } catch {
    return [];
  }
}

function writeRecent(keys: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(keys));
  } catch {
    /* A private window keeps it for this visit only. */
  }
}

/**
 * The apps you reach for, first: the one that's open, then the ones you opened
 * most recently, then the rest in the order they were added. Nothing to set —
 * the row arranges itself, and the folder keeps every app in its own order.
 */
export function favouritesFirst(items: AppDockItem[], recent: string[]): AppDockItem[] {
  const rank = (item: AppDockItem) => {
    if (item.active) return -1;
    const at = recent.indexOf(item.key);
    return at === -1 ? recent.length : at;
  };
  return items
    .map((item, at) => ({ item, at, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map((r) => r.item);
}

/** The keys most recently opened, newest first, with `key` put at the front. */
export function remember(recent: string[], key: string): string[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, RECENT_MAX);
}

/** Which apps were opened last, on this device, and a way to note another. */
export function useAppsOpened() {
  const [recent, setRecent] = useState<string[]>(readRecent);
  const opened = useCallback((key: string) => {
    setRecent((was) => {
      const next = remember(was, key);
      writeRecent(next);
      return next;
    });
  }, []);
  return { recent, opened };
}
