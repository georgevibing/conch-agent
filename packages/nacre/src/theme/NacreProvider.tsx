import { MotionConfig } from 'motion/react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { installLustre } from '../lustre';
import { useMediaQuery } from '../utils/useMediaQuery';
import {
  resolveAccent,
  resolveNeutral,
  type AccentColor,
  type AccentName,
  type NeutralName,
  type NeutralTint,
} from './accents';
import { installVisibleViewport } from './visibleViewport';

export type ColorMode = 'light' | 'dark' | 'system';
export type MotionPreference = 'system' | 'reduced' | 'full';

export interface NacreTheme {
  mode: ColorMode;
  accent: AccentName | AccentColor;
  neutral: NeutralName | NeutralTint;
  /** Intensity of the Lustre sheen, 0 (off) to 1. */
  lustre: number;
  /** Global radius multiplier. 0 = square, 1 = default, 1.5 = extra round. */
  radius: number;
  motion: MotionPreference;
}

export interface NacreContextValue extends NacreTheme {
  /** The mode actually being rendered once `system` is resolved. */
  resolvedMode: 'light' | 'dark';
  setTheme: (patch: Partial<NacreTheme>) => void;
}

const fallbackTheme: NacreTheme = {
  mode: 'system',
  accent: 'coral',
  neutral: 'porcelain',
  lustre: 1,
  radius: 1,
  motion: 'system',
};

const NacreContext = createContext<NacreContextValue | null>(null);

export interface NacreProviderProps extends Partial<NacreTheme> {
  children: ReactNode;
  /** Initial theme for uncontrolled usage; later changes go through `setTheme`. */
  defaultTheme?: Partial<NacreTheme>;
  /**
   * `document` (default) themes `<html>` so portalled overlays inherit the
   * theme. `local` wraps children in a themed element — handy for rendering
   * several themes side by side (overlays will portal to the document theme).
   */
  scope?: 'document' | 'local';
  /** Persist theme changes to localStorage under this key. */
  storageKey?: string;
  className?: string;
  style?: CSSProperties;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function readStored(key: string | undefined): Partial<NacreTheme> {
  if (!key || typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<NacreTheme>;
  } catch {
    return {};
  }
}

function definedProps(props: Partial<NacreTheme>): Partial<NacreTheme> {
  return Object.fromEntries(
    Object.entries(props).filter(([, v]) => v !== undefined),
  ) as Partial<NacreTheme>;
}

function themeVars(theme: NacreTheme): Record<string, string> {
  const accent = resolveAccent(theme.accent);
  const neutral = resolveNeutral(theme.neutral, accent);
  return {
    '--nc-accent-h': String(accent.hue),
    '--nc-accent-c': String(accent.chroma),
    '--nc-neutral-h': String(neutral.hue),
    '--nc-neutral-c': String(neutral.chroma),
    '--nc-lustre': String(Math.min(1, Math.max(0, theme.lustre))),
    '--nc-radius-scale': String(Math.max(0, theme.radius)),
  };
}

function themeAttrs(theme: NacreTheme): Record<string, string> {
  return {
    'data-nacre-root': '',
    'data-nacre-theme': '',
    'data-nacre-mode': theme.mode,
    'data-nacre-motion': theme.motion,
  };
}

/**
 * Root of every Nacre UI. Provides theme context, installs the Lustre pointer
 * listener and the shared tooltip delay group.
 */
export function NacreProvider({
  children,
  scope = 'document',
  storageKey,
  className,
  style,
  defaultTheme,
  ...controlled
}: NacreProviderProps) {
  // Uncontrolled state seeded from `defaultTheme` and storage; any theme prop
  // passed explicitly is controlled and always wins (e.g. Storybook globals).
  const [local, setLocal] = useState<NacreTheme>(() => ({
    ...fallbackTheme,
    ...defaultTheme,
    ...readStored(storageKey),
  }));
  // Serialised so inline objects (e.g. `accent={{ hue, chroma }}`) don't
  // invalidate the theme on every render.
  const controlledKey = JSON.stringify(definedProps(controlled));
  const theme = useMemo<NacreTheme>(
    () => ({ ...local, ...(JSON.parse(controlledKey) as Partial<NacreTheme>) }),
    [local, controlledKey],
  );

  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(local));
  }, [storageKey, local]);

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const resolvedMode = theme.mode === 'system' ? (prefersDark ? 'dark' : 'light') : theme.mode;

  useEffect(() => installLustre(), []);

  useIsoLayoutEffect(() => (scope === 'document' ? installVisibleViewport() : undefined), [scope]);

  useIsoLayoutEffect(() => {
    if (scope !== 'document') return;
    const root = document.documentElement;
    const attrs = themeAttrs(theme);
    const vars = themeVars(theme);
    for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    return () => {
      for (const k of Object.keys(attrs)) root.removeAttribute(k);
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    };
  }, [scope, theme]);

  const setTheme = useCallback(
    (patch: Partial<NacreTheme>) => setLocal((prev) => ({ ...prev, ...patch })),
    [setLocal],
  );
  const value = useMemo<NacreContextValue>(
    () => ({ ...theme, resolvedMode, setTheme }),
    [theme, resolvedMode, setTheme],
  );

  // JS-driven animations (the `motion` library) honour the same preference as CSS.
  const reducedMotion =
    theme.motion === 'reduced' ? 'always' : theme.motion === 'full' ? 'never' : 'user';

  const content = (
    <MotionConfig reducedMotion={reducedMotion}>
      <TooltipPrimitive.Provider delayDuration={420} skipDelayDuration={260}>
        {children}
      </TooltipPrimitive.Provider>
    </MotionConfig>
  );

  return (
    <NacreContext.Provider value={value}>
      {scope === 'local' ? (
        <div
          {...themeAttrs(theme)}
          className={className}
          style={{ ...(themeVars(theme) as CSSProperties), ...style }}
        >
          {content}
        </div>
      ) : (
        content
      )}
    </NacreContext.Provider>
  );
}

export function useNacreTheme(): NacreContextValue {
  const ctx = useContext(NacreContext);
  if (!ctx) throw new Error('useNacreTheme must be used inside <NacreProvider>.');
  return ctx;
}
