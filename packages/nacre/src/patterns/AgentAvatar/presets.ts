import { createContext, type ComponentType, type ReactNode, type SVGProps } from 'react';

import { FIGURES } from './figures';

/**
 * The colours a face is drawn in: Nacre's app colours (`--nc-app-*`), the
 * same thirteen as `AppColor` in `@conch/protocol`.
 */
export const AGENT_AVATAR_COLORS = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
  'slate',
] as const;
export type AgentAvatarColor = (typeof AGENT_AVATAR_COLORS)[number];

/** How one preset is drawn: its figure on a glazed tile of its colour. */
export interface AgentAvatarArt {
  /** What the look is called where one is chosen ("Owl"). */
  label: string;
  /** Its colour when the agent hasn't chosen one. */
  color: AgentAvatarColor;
  /**
   * The character, filling the tile: the inside of a 64-unit `<svg>`, drawn
   * in the tile's own mixed colours (`figures.tsx`). Nacre's cast.
   */
  figure?: () => ReactNode;
  /**
   * Or a single-colour glyph, drawn in `currentColor` at the tile's middle (a
   * Lucide icon, or any SVG component taking `className`). Neither: it's
   * Conch's spiral.
   */
  glyph?: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * What an agent's `avatar` says, as `@conch/protocol` sends it: a preset by
 * id with its colour, or a picture by its address. Nacre stays free of the
 * protocol, so it reads the shape, not the type.
 */
export type AgentFace =
  { kind: 'preset'; id: string; color?: string } | { kind: 'image'; url: string };

/**
 * Nacre's drawing of every preset the protocol names (`AGENT_AVATAR_PRESETS`):
 * Conch's own mark for `shell`, and a cast of characters for the rest, each in
 * a colour of its own (any of the thirteen can take its place). The web app
 * can draw its own over any of them with `AgentAvatarArtProvider`.
 */
export const AGENT_AVATAR_ART: Readonly<Record<string, AgentAvatarArt>> = {
  shell: { label: 'Shell', color: 'orange' },
  pearl: { label: 'Pearl', color: 'slate', figure: FIGURES.pearl },
  wave: { label: 'Wave', color: 'teal', figure: FIGURES.wave },
  coral: { label: 'Coral', color: 'pink', figure: FIGURES.coral },
  spark: { label: 'Spark', color: 'yellow', figure: FIGURES.spark },
  leaf: { label: 'Leaf', color: 'green', figure: FIGURES.leaf },
  moon: { label: 'Moon', color: 'indigo', figure: FIGURES.moon },
  sun: { label: 'Sun', color: 'amber', figure: FIGURES.sun },
  star: { label: 'Star', color: 'blue', figure: FIGURES.star },
  cloud: { label: 'Cloud', color: 'cyan', figure: FIGURES.cloud },
  flame: { label: 'Flame', color: 'red', figure: FIGURES.flame },
  feather: { label: 'Feather', color: 'lime', figure: FIGURES.feather },
  compass: { label: 'Compass', color: 'teal', figure: FIGURES.compass },
  orbit: { label: 'Orbit', color: 'violet', figure: FIGURES.orbit },
  owl: { label: 'Owl', color: 'amber', figure: FIGURES.owl },
  fox: { label: 'Fox', color: 'orange', figure: FIGURES.fox },
  cat: { label: 'Cat', color: 'pink', figure: FIGURES.cat },
  bot: { label: 'Bot', color: 'indigo', figure: FIGURES.bot },
};

/**
 * The extension point for preset artwork: the web app hands its own drawings
 * here once, and every `AgentAvatar` under it uses them (merged over Nacre's,
 * by id). An id with no drawing anywhere falls back to Conch's mark.
 */
export const AgentAvatarArtContext =
  createContext<Readonly<Record<string, AgentAvatarArt>>>(AGENT_AVATAR_ART);

/** What an avatar draws. */
export type AgentAvatarLook =
  | { kind: 'mark' }
  | { kind: 'preset'; id: string; art: AgentAvatarArt; color: AgentAvatarColor }
  | { kind: 'picture'; src: string };

/** An address a picture can be loaded from: the web, this server, or one made on the page. */
const PICTURE = /^(?:https?:\/\/|\/(?!\/)|data:image\/|blob:)/i;

const isColor = (value: string | undefined): value is AgentAvatarColor =>
  (AGENT_AVATAR_COLORS as readonly string[]).includes(value ?? '');

/**
 * Reads an agent's `avatar`: the protocol's `{ kind, … }`, or for short a
 * preset's id ("spark") or a picture's address. Nothing, a preset with no
 * drawing (a newer one, a typo) or an address that isn't one all fall back to
 * Conch's mark, never to a blank. `shell` in its own colour is the mark itself.
 */
export function agentAvatarLook(
  avatar: AgentFace | string | undefined,
  art: Readonly<Record<string, AgentAvatarArt>> = AGENT_AVATAR_ART,
): AgentAvatarLook {
  const face: AgentFace | undefined =
    typeof avatar === 'string'
      ? PICTURE.test(avatar.trim())
        ? { kind: 'image', url: avatar.trim() }
        : { kind: 'preset', id: avatar.trim() }
      : avatar;
  if (!face) return { kind: 'mark' };
  if (face.kind === 'image') {
    return PICTURE.test(face.url) ? { kind: 'picture', src: face.url } : { kind: 'mark' };
  }
  const drawn = Object.hasOwn(art, face.id) ? art[face.id] : undefined;
  if (!drawn) return { kind: 'mark' };
  const color = isColor(face.color) ? face.color : drawn.color;
  if (!drawn.glyph && !drawn.figure && face.id === 'shell' && !isColor(face.color))
    return { kind: 'mark' };
  return { kind: 'preset', id: face.id, art: drawn, color };
}
