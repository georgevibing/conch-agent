/**
 * Where Ollama is — on this computer, and nowhere else.
 *
 * Ollama listens on 127.0.0.1:11434 unless `OLLAMA_HOST` says otherwise, and
 * that variable is shared with every other Ollama client on the machine. Conch
 * reads it, but only follows it to this computer: a loopback address (or the
 * "every address" binding, which this computer answers on too). An address
 * that leads anywhere else is refused, and the page says so — a local model
 * that quietly sends every chat to another machine would break the one promise
 * the feature makes.
 *
 * The address Conch uses is always an IP literal (`127.0.0.1`, `[::1]`), never
 * a name that DNS could answer differently next time.
 */

export const DEFAULT_PORT = 11434;

export interface OllamaHost {
  /** `http://127.0.0.1:11434`, with no trailing slash. */
  url: string;
  /** Set when `OLLAMA_HOST` pointed elsewhere and Conch used the default instead. */
  refused?: string;
}

const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;

/** `host` (no brackets) as Conch will dial it, or undefined when it isn't this computer. */
function loopback(host: string): string | undefined {
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower === '' || lower === '0.0.0.0') return '127.0.0.1';
  if (LOOPBACK_V4.test(lower) && lower.split('.').every((part) => Number(part) <= 255))
    return lower;
  // `::` is "every address", like 0.0.0.0; `::1` is loopback.
  if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1') return '[::1]';
  return undefined;
}

/**
 * Read `OLLAMA_HOST` the way Ollama does — `host`, `host:port`, `:port`,
 * `scheme://host:port`, `[::1]:port` — and keep it only if it's this computer.
 */
export function ollamaHost(value: string | undefined): OllamaHost {
  const fallback = `http://127.0.0.1:${DEFAULT_PORT}`;
  const raw = value?.trim();
  if (!raw) return { url: fallback };

  const refuse = (): OllamaHost => ({ url: fallback, refused: raw.slice(0, 200) });
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (scheme && !/^https?$/i.test(scheme[1] ?? '')) return refuse();
  // Everything after the address (a path, a query) means nothing to Conch.
  const rest = (scheme ? raw.slice(scheme[0].length) : raw).split(/[/?#]/)[0] ?? '';
  // Credentials in the address would be a proxy somewhere, not Ollama here.
  if (rest.includes('@')) return refuse();

  let host: string;
  let port: string | undefined;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest);
  if (bracketed) {
    host = bracketed[1] ?? '';
    port = bracketed[2];
  } else if ((rest.match(/:/g) ?? []).length > 1) {
    // An IPv6 address without brackets carries no port.
    host = rest;
  } else {
    const [h, p] = rest.split(':');
    host = h ?? '';
    port = p;
  }
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return refuse();
  const portNumber = port === undefined || port === '' ? DEFAULT_PORT : Number(port);
  if (portNumber < 1 || portNumber > 65535) return refuse();

  const dial = loopback(host);
  if (!dial) return refuse();
  return { url: `http://${dial}:${portNumber}` };
}

/** Whether a URL is one `ollamaHost` could have produced: plain http to this computer. */
export function isLoopbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' || parsed.username || parsed.password) return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  return host === '::1' || LOOPBACK_V4.test(host);
}
