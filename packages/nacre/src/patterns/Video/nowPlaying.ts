import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Only one video plays at a time, in the whole chat: pressing play on one
 * puts every other back to its poster (its player is taken away, so it stops
 * and nothing of it keeps loading).
 */
let playing: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null) {
  if (next === playing) return;
  playing = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether `key` is the one playing, and the ways to play and stop it. */
export function useNowPlaying(key: string) {
  const isPlaying = useSyncExternalStore(
    subscribe,
    () => playing === key,
    () => false,
  );
  const play = useCallback(() => set(key), [key]);
  const stop = useCallback(() => {
    if (playing === key) set(null);
  }, [key]);
  // A card that goes away takes its player with it.
  useEffect(
    () => () => {
      if (playing === key) set(null);
    },
    [key],
  );
  return { isPlaying, play, stop };
}

/** Play this one (the shelf hands play on to the video it swaps in). */
export function playVideo(key: string) {
  set(key);
}

/** For tests and stories: nothing playing. */
export function stopAllVideos() {
  set(null);
}
