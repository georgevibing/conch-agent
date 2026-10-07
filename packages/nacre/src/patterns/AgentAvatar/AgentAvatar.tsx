import {
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type SVGProps,
} from 'react';

import { hueFromString, initialsOf } from '../../components/Avatar/Avatar';
import { cx } from '../../utils/cx';
import styles from './AgentAvatar.module.css';
import {
  AGENT_AVATAR_ART,
  AgentAvatarArtContext,
  agentAvatarLook,
  type AgentAvatarArt,
  type AgentFace,
} from './presets';

/**
 * Who is speaking in a chat: an agent's name, and its face — the protocol's
 * `AgentAvatar` (a preset or a picture), or for short a preset's id or a
 * picture's address. Without one it wears Conch's mark.
 */
export interface Speaker {
  name: string;
  avatar?: AgentFace | string;
}

export type AgentAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

export interface AgentAvatarProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** The agent's name: what it's read as, and its initial if its picture can't load. */
  name: string;
  /**
   * Its face: `{ kind: 'preset', id, color? }` or `{ kind: 'image', url }`,
   * or a preset's id or a picture's address. Anything else is Conch's mark.
   */
  avatar?: AgentFace | string;
  /**
   * 20 / 26 / 32 / 40 / 56 px, the same steps as a person's `Avatar`; then
   * 96 px for a gallery of agents and 136 px for one agent's own page.
   */
  size?: AgentAvatarSize;
  /** The agent is working: the mark's spiral draws itself, and light orbits the rim. */
  active?: boolean;
  /** Epoch ms the work began, so the motion carries on across remounts. */
  since?: number;
  /** Leave it unread when the name is right beside it (a speaker line, a list row). */
  decorative?: boolean;
}

/**
 * Draws the presets with the web app's own artwork, merged over Nacre's by id
 * (`AGENT_AVATAR_ART`): set once near the root, used by every `AgentAvatar`.
 */
export function AgentAvatarArtProvider({
  art,
  children,
}: {
  art: Readonly<Record<string, AgentAvatarArt>>;
  children: ReactNode;
}) {
  const merged = useMemo(() => ({ ...AGENT_AVATAR_ART, ...art }), [art]);
  return <AgentAvatarArtContext value={merged}>{children}</AgentAvatarArtContext>;
}

/**
 * While working, light orbits the rim; when the work ends, one ring of light
 * passes around it. `age` is how far into its loops the motion is, read when
 * it starts and then fixed, so a re-render never shifts a running animation.
 */
function useWork(active: boolean | undefined, since: number | undefined) {
  const [landed, setLanded] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  const [age, setAge] = useState(() => (active ? ageOf(since) : 0));
  if (Boolean(active) !== Boolean(wasActive)) {
    setWasActive(active);
    if (!active) setLanded(true);
    else setAge(ageOf(since));
  }
  useEffect(() => {
    if (!landed) return;
    const id = setTimeout(() => setLanded(false), 1200);
    return () => clearTimeout(id);
  }, [landed]);
  return { landed, age };
}

function ageOf(since: number | undefined): number {
  return since === undefined ? 0 : Math.max(0, Date.now() - since);
}

/** Conch's spiral: a shell of growing quarter-arcs (a golden spiral). */
function Spiral({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="3.5 3.5 17 17" className={cx(styles.markGlyph, className)} {...props}>
      <path
        pathLength={1}
        d="M12 12a1.5 1.5 0 0 1 1.5 1.5a3 3 0 0 1-3 3a4.5 4.5 0 0 1-4.5-4.5a6 6 0 0 1 6-6a7.5 7.5 0 0 1 7.5 7.5"
        transform="translate(0 -1.5)"
      />
    </svg>
  );
}

/**
 * Conch's mark: a small glazed tile in the accent with a pearl rim. While
 * `active`, the conch spiral draws itself from the centre out, flows away and
 * grows again — a shell forming — as the rim's light orbits. When work
 * finishes a single ring of light passes around it.
 */
export function MessageMark({
  active,
  since,
  className,
  style,
  ...props
}: ComponentProps<'span'> & {
  active?: boolean;
  /** Epoch ms the work began: the spiral keeps time from it across remounts. */
  since?: number;
}) {
  const { landed, age } = useWork(active, since);
  return (
    <span
      // Decoration, unless it's named (an agent's face, standing alone).
      aria-hidden={props['aria-label'] ? undefined : true}
      data-active={active || undefined}
      data-landed={landed || undefined}
      className={cx(styles.avatar, styles.mark, className)}
      style={{ '--nc-mark-age': `${age}ms`, ...style } as CSSProperties}
      {...props}
    >
      <Spiral />
    </span>
  );
}

/**
 * An agent's face, wherever it appears: beside its name over a reply, in a
 * list of agents, on its own page. Agents are drawn as rounded tiles, people
 * (`Avatar`) as circles, so the two are never mistaken for each other.
 *
 * A preset is one of Nacre's cast on a glazed tile of its colour (the web
 * app can draw its own, `AgentAvatarArtProvider`); the small details of a
 * figure fall away at `xs` and `sm`. A picture shows the name's initial
 * on its own tint until it has loaded, and keeps it if it can't. No avatar,
 * or a preset nobody draws, is Conch's mark.
 */
export function AgentAvatar({
  name,
  avatar,
  size = 'md',
  active,
  since,
  decorative,
  className,
  style,
  ...props
}: AgentAvatarProps) {
  const look = agentAvatarLook(avatar, useContext(AgentAvatarArtContext));
  const { landed, age } = useWork(look.kind === 'mark' ? false : active, since);
  const named = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': name };
  if (look.kind === 'mark') {
    return (
      <MessageMark
        active={active}
        since={since}
        data-size={size}
        className={className}
        style={style}
        {...props}
        {...named}
      />
    );
  }
  return (
    <span
      data-size={size}
      data-look={look.kind}
      data-figure={(look.kind === 'preset' && Boolean(look.art.figure)) || undefined}
      data-preset={look.kind === 'preset' ? look.id : undefined}
      data-color={look.kind === 'preset' ? look.color : undefined}
      data-active={active || undefined}
      data-landed={landed || undefined}
      className={cx(styles.avatar, styles.tile, className)}
      style={
        {
          '--nc-mark-age': `${age}ms`,
          '--aa-h': hueFromString(name),
          ...style,
        } as CSSProperties
      }
      {...props}
      {...named}
    >
      {look.kind === 'preset' ? (
        look.art.figure ? (
          <svg viewBox="0 0 64 64" aria-hidden focusable="false" className={styles.figure}>
            {look.art.figure()}
          </svg>
        ) : (
          createElement(look.art.glyph ?? Spiral, {
            'aria-hidden': true,
            className: look.art.glyph ? styles.glyph : undefined,
          })
        )
      ) : (
        <Picture key={look.src} src={look.src} name={name} />
      )}
    </span>
  );
}

/** The picture over its initial: the initial until it's loaded, and for good if it can't be. */
function Picture({ src, name }: { src: string; name: string }) {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  return (
    <>
      <span aria-hidden className={styles.initial}>
        {initialsOf(name).slice(0, 1)}
      </span>
      {state !== 'failed' && (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          className={styles.picture}
          data-shown={state === 'shown' || undefined}
          // A picture already in the cache may be complete before React listens.
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0 && state === 'loading') setState('shown');
          }}
          onLoad={() => setState('shown')}
          onError={() => setState('failed')}
        />
      )}
    </>
  );
}
