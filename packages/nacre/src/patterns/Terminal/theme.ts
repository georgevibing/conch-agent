/**
 * The terminal's colours, from Nacre's tokens (`--nc-term-*`). Tokens are
 * resolved through a probe element inside the terminal, so light/dark and the
 * accent apply exactly as for any other component, then turned into plain
 * rgb() strings xterm can use.
 */

export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const TOKENS: Record<keyof TerminalColors, string> = {
  background: '--nc-term-bg',
  foreground: '--nc-term-fg',
  cursor: '--nc-term-cursor',
  cursorAccent: '--nc-term-bg',
  selectionBackground: '--nc-term-selection',
  black: '--nc-term-black',
  red: '--nc-term-red',
  green: '--nc-term-green',
  yellow: '--nc-term-yellow',
  blue: '--nc-term-blue',
  magenta: '--nc-term-magenta',
  cyan: '--nc-term-cyan',
  white: '--nc-term-white',
  brightBlack: '--nc-term-bright-black',
  brightRed: '--nc-term-bright-red',
  brightGreen: '--nc-term-bright-green',
  brightYellow: '--nc-term-bright-yellow',
  brightBlue: '--nc-term-bright-blue',
  brightMagenta: '--nc-term-bright-magenta',
  brightCyan: '--nc-term-bright-cyan',
  brightWhite: '--nc-term-bright-white',
};

let canvas: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour (oklch, color-mix…) as rgb()/rgba(), by painting one pixel. */
export function toRgb(color: string): string {
  canvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!canvas) return color;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = '#000';
  canvas.fillStyle = color;
  canvas.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = canvas.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

/** The colours for a terminal inside `host`, as the current theme has them. */
export function terminalColors(host: HTMLElement): TerminalColors {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  try {
    const out = {} as TerminalColors;
    for (const [key, token] of Object.entries(TOKENS) as [keyof TerminalColors, string][]) {
      probe.style.color = `var(${token})`;
      out[key] = toRgb(getComputedStyle(probe).color);
    }
    return out;
  } finally {
    probe.remove();
  }
}

/** The monospace family, as the theme sets it. */
export function terminalFont(host: HTMLElement): string {
  return getComputedStyle(host).getPropertyValue('--nc-font-mono').trim() || 'monospace';
}
