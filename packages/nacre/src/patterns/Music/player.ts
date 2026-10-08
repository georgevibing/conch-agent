/**
 * The one player behind every music card in the chat. One `<audio>` for the
 * whole page, so only one thing ever plays: pressing play on a card stops
 * whatever was playing on another. Cards and the mini player read it with
 * `useMusicPlayer`; the clock (where the playhead is) is read apart, by the
 * card that's playing only, so nothing else draws again while it moves.
 *
 * It also tells the system what's playing (the Media Session API), so the
 * keyboard's media keys, a headset's buttons and the lock screen work.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';

export type MusicKind = 'song' | 'album' | 'artist' | 'podcast' | 'episode';

export interface MusicLinks {
  apple?: string;
  spotify?: string;
  youtube?: string;
}

export interface MusicTrack {
  /** Stable within its card: the preview's address, or the kind and title. */
  id: string;
  kind: MusicKind;
  title: string;
  /** The artist, or the show an episode is from. */
  by?: string;
  album?: string;
  /** The cover, from Conch itself. */
  artwork?: string;
  /** Seconds, of the whole song or episode. */
  duration?: number;
  /** ISO date it came out. */
  released?: string;
  genre?: string;
  explicit?: boolean;
  /** An episode's few words about itself. */
  description?: string;
  /** An album's songs, a show's episodes. */
  tracks?: number;
  /** What plays, from Conch itself. Nothing: it can't be played here. */
  src?: string;
  /** `src` is the whole episode, not a 30-second preview. */
  whole?: boolean;
  links?: MusicLinks;
}

export interface PlayerState {
  /** What's loaded: playing, paused, or just finished. */
  track?: MusicTrack;
  /** The card it was played from. */
  card?: string;
  /** What plays next and before, from the same card. */
  queue: MusicTrack[];
  playing: boolean;
  /** Waiting for the stream. */
  buffering: boolean;
  /** Seconds, once the stream says. */
  duration?: number;
  rate: number;
  /** It couldn't be played: why, in a sentence. */
  problem?: string;
  /** The card it was played from is in sight. */
  cardInSight: boolean;
}

/** What `<audio>` the player drives: the real one, or a stand-in in tests. */
export type AudioLike = Pick<
  HTMLAudioElement,
  | 'play'
  | 'pause'
  | 'currentTime'
  | 'duration'
  | 'paused'
  | 'playbackRate'
  | 'src'
  | 'preload'
  | 'addEventListener'
  | 'removeEventListener'
  | 'removeAttribute'
  | 'load'
>;

export interface MusicPlayer {
  state(): PlayerState;
  subscribe(listener: () => void): () => void;
  /** Where the playhead is, in seconds. */
  time(): number;
  play(track: MusicTrack, options?: { card?: string; queue?: MusicTrack[] }): void;
  toggle(track?: MusicTrack, options?: { card?: string; queue?: MusicTrack[] }): void;
  pause(): void;
  seek(seconds: number): void;
  skip(by: number): void;
  setRate(rate: number): void;
  next(): void;
  previous(): void;
  /** Stop and forget what was playing (the mini player's close). */
  stop(): void;
  /** A card says whether it's in sight; the mini player shows when the playing one isn't. */
  sight(card: string, inSight: boolean, el?: HTMLElement | null): void;
  /** Bring the playing card back into view. */
  reveal(): void;
}

const INITIAL: PlayerState = {
  queue: [],
  playing: false,
  buffering: false,
  rate: 1,
  cardInSight: true,
};

/** The player, on an `<audio>` made when it's first needed. */
export function createMusicPlayer(make: () => AudioLike = () => new Audio()): MusicPlayer {
  let audio: AudioLike | undefined;
  let state: PlayerState = INITIAL;
  const listeners = new Set<() => void>();
  const inSight = new Map<string, boolean>();
  const cards = new Map<string, HTMLElement>();

  const set = (next: Partial<PlayerState>) => {
    state = { ...state, ...next };
    state.cardInSight = state.card ? (inSight.get(state.card) ?? true) : true;
    for (const l of listeners) l();
    session();
  };

  const element = (): AudioLike => {
    if (audio) return audio;
    const a = make();
    a.preload = 'metadata';
    a.addEventListener('playing', () =>
      set({ playing: true, buffering: false, problem: undefined }),
    );
    a.addEventListener('pause', () => set({ playing: false }));
    a.addEventListener('waiting', () => set({ buffering: true }));
    a.addEventListener('canplay', () => set({ buffering: false }));
    a.addEventListener('durationchange', () =>
      set({ duration: Number.isFinite(a.duration) && a.duration > 0 ? a.duration : undefined }),
    );
    a.addEventListener('ended', () => {
      set({ playing: false });
      // A card's songs play on, one after another; an episode just ends.
      if (state.track && !state.track.whole) player.next();
    });
    a.addEventListener('error', () => {
      if (!state.track) return;
      set({
        playing: false,
        buffering: false,
        problem: state.track.whole
          ? 'This episode couldn’t be played. Its own app may still have it.'
          : 'This preview couldn’t be played. Try another, or open it in a music app.',
      });
    });
    audio = a;
    return a;
  };

  const start = (a: AudioLike) => {
    a.playbackRate = state.track?.whole ? state.rate : 1;
    const p = a.play() as Promise<void> | undefined;
    p?.catch((error: unknown) => {
      // Stopped by the next play or a pause: not a problem.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      set({
        playing: false,
        buffering: false,
        ...(error instanceof DOMException &&
          error.name === 'NotAllowedError' && { problem: 'Press play again to listen.' }),
      });
    });
  };

  const session = () => {
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
    if (!media || typeof MediaMetadata === 'undefined') return;
    const track = state.track;
    if (!track) {
      media.metadata = null;
      media.playbackState = 'none';
      return;
    }
    if (media.metadata?.title !== track.title || media.metadata.artist !== (track.by ?? '')) {
      media.metadata = new MediaMetadata({
        title: track.title,
        artist: track.by ?? '',
        album: track.album ?? '',
        artwork: track.artwork
          ? [{ src: new URL(track.artwork, location.href).href, sizes: '600x600' }]
          : [],
      });
    }
    media.playbackState = state.playing ? 'playing' : 'paused';
  };

  const at = (index: number) => {
    const playable = state.queue.filter((t) => t.src);
    const here = playable.findIndex((t) => t.id === state.track?.id);
    return here < 0 ? undefined : playable[here + index];
  };

  const player: MusicPlayer = {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    time: () => audio?.currentTime ?? 0,
    play(track, options = {}) {
      if (!track.src) return;
      const a = element();
      const same = state.track?.id === track.id && state.card === (options.card ?? state.card);
      if (!same) {
        a.src = track.src;
        a.currentTime = 0;
        set({
          track,
          card: options.card,
          queue: options.queue ?? [track],
          duration: undefined,
          problem: undefined,
          buffering: true,
          rate: track.whole ? state.rate : 1,
        });
        handlers();
      }
      start(a);
    },
    toggle(track, options) {
      if (
        !track ||
        (state.track?.id === track.id && state.card === (options?.card ?? state.card))
      ) {
        if (!state.track) return;
        if (state.playing) player.pause();
        else start(element());
        return;
      }
      player.play(track, options);
    },
    pause() {
      audio?.pause();
    },
    seek(seconds) {
      if (!audio || !state.track) return;
      const end = state.duration ?? audio.duration;
      audio.currentTime = Math.max(0, Number.isFinite(end) ? Math.min(seconds, end) : seconds);
      for (const l of listeners) l();
    },
    skip(by) {
      player.seek(player.time() + by);
    },
    setRate(rate) {
      if (audio && state.track?.whole) audio.playbackRate = rate;
      set({ rate });
    },
    next() {
      const track = at(1);
      if (track) player.play(track, { card: state.card, queue: state.queue });
    },
    previous() {
      if (player.time() > 3) return player.seek(0);
      const track = at(-1);
      if (track) player.play(track, { card: state.card, queue: state.queue });
      else player.seek(0);
    },
    stop() {
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      set({
        ...INITIAL,
        track: undefined,
        card: undefined,
        duration: undefined,
        problem: undefined,
        rate: state.rate,
      });
    },
    sight(card, seen, el) {
      inSight.set(card, seen);
      if (el) cards.set(card, el);
      if (card === state.card) set({});
    },
    reveal() {
      const el = state.card ? cards.get(state.card) : undefined;
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    },
  };

  const handlers = () => {
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
    if (!media) return;
    const on = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        media.setActionHandler(action, handler);
      } catch {
        // This browser doesn't know that one.
      }
    };
    on('play', () => player.toggle());
    on('pause', () => player.pause());
    on('stop', () => player.stop());
    on('seekbackward', (d) => player.skip(-(d.seekOffset ?? (state.track?.whole ? 15 : 5))));
    on('seekforward', (d) => player.skip(d.seekOffset ?? (state.track?.whole ? 30 : 5)));
    on('seekto', (d) => d.seekTime !== undefined && player.seek(d.seekTime));
    on('previoustrack', () => player.previous());
    on('nexttrack', () => player.next());
  };

  return player;
}

/** The page's one player. */
export const musicPlayer: MusicPlayer = createMusicPlayer();

/** Which player the cards use: the page's, or a stand-in (tests, stories). */
export const MusicPlayerContext = createContext<MusicPlayer>(musicPlayer);

export function useMusicPlayer(): [PlayerState, MusicPlayer] {
  const player = useContext(MusicPlayerContext);
  const state = useSyncExternalStore(player.subscribe, player.state, player.state);
  return [state, player];
}

/**
 * Where the playhead is, for the one that's playing: every frame while it
 * plays (so the scrubber glides), still otherwise. Off, it reads nothing.
 */
export function useMusicTime(on: boolean): number {
  const [state, player] = useMusicPlayer();
  const [time, setTime] = useState(0);
  const playing = on && state.playing;
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = -1;
    const tick = () => {
      const now = player.time();
      if (Math.abs(now - last) > 0.03) {
        last = now;
        setTime(now);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, player]);
  // Keep the system's lock screen in step, now and then.
  useEffect(() => {
    if (!on || !state.duration) return;
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
    try {
      media?.setPositionState?.({
        duration: state.duration,
        position: Math.min(player.time(), state.duration),
        playbackRate: state.track?.whole ? state.rate : 1,
      });
    } catch {
      // A position the system won't take.
    }
  }, [on, state.duration, state.rate, state.playing, state.track, player]);
  // Paused, the playhead only moves when someone seeks, and that draws again by itself.
  return !on ? 0 : playing && time > 0 ? time : player.time();
}
