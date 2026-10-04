/**
 * Does the name lead here, from the outside? (ADR 0064)
 *
 * Before asking a certificate authority (whose failures count against its
 * limits), Conch serves a random token on its port 80 listener and fetches
 * it through the name. Only this Conch knows the token, so an answer that
 * matches means the record, the firewall and the port all lead here.
 */
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';

import { chosenResolvers, lookupName } from './dns';
import { FIREWALL_HINT, type AddressProblem } from './problems';

export type ReachResult =
  | { ok: true }
  | { ok: false; why: 'dns' | 'refused' | 'timeout' | 'elsewhere'; problem: AddressProblem };

const CODE = (error: unknown): string => {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code ?? (error as { code?: string }).code ?? (error as Error).name;
};

/** GET `path` from `name` at the address the chosen resolvers give it. */
async function viaChosen(
  name: string,
  port: number,
  path: string,
  timeoutMs: number,
): Promise<string> {
  const found = await lookupName(name);
  const address = found.v4[0] ?? found.v6[0];
  if (!address) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: address, port, path, headers: { host: name }, timeout: timeoutMs },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => resolve(response.statusCode === 200 ? text.trim() : ''));
      },
    );
    request.on('timeout', () =>
      request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
    );
    request.on('error', reject);
    request.end();
  });
}

export async function checkReach(
  name: string,
  deps: {
    /** Where the port 80 listener looks answers up (`ListenerOptions.checks`). */
    checks: Map<string, string>;
    /** The port the internet reaches the listener on (80, unless a test says). */
    port?: number;
    fetch?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<ReachResult> {
  const nonce = randomBytes(16).toString('base64url');
  const token = randomBytes(24).toString('base64url');
  deps.checks.set(nonce, token);
  const port = deps.port && deps.port !== 80 ? `:${deps.port}` : '';
  try {
    const path = `/.well-known/conch-check/${nonce}`;
    // With resolvers of its own (`CONCH_DNS_SERVERS`, a test network), the name is looked up
    // there and asked for by address, as the internet would reach it.
    const body =
      chosenResolvers() && !deps.fetch
        ? await viaChosen(name, deps.port ?? 80, path, deps.timeoutMs ?? 8000)
        : await (async () => {
            const response = await (deps.fetch ?? fetch)(`http://${name}${port}${path}`, {
              redirect: 'manual',
              signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
            });
            return response.ok ? (await response.text()).trim() : '';
          })();
    if (body === token) return { ok: true };
    return {
      ok: false,
      why: 'elsewhere',
      problem: {
        kind: 'dns',
        message: `${name} leads to another server, not this one. Point its record at this server, then try again.`,
      },
    };
  } catch (error) {
    const code = CODE(error);
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
      return {
        ok: false,
        why: 'dns',
        problem: {
          kind: 'dns',
          message: `${name} can’t be found yet. Add its record at your domain provider; new records can take a few minutes to arrive.`,
        },
      };
    if (code === 'ECONNREFUSED')
      return {
        ok: false,
        why: 'refused',
        problem: {
          kind: 'unreachable',
          message: `${name} refused the connection on port 80. ${FIREWALL_HINT}`,
        },
      };
    return {
      ok: false,
      why: 'timeout',
      problem: {
        kind: 'unreachable',
        message: `Nothing answered at ${name} on port 80 from the internet. ${FIREWALL_HINT}`,
      },
    };
  } finally {
    deps.checks.delete(nonce);
  }
}

/** Through a proxy: reached, and whether a sign-in of the proxy's own stands in front. */
export type ThroughResult =
  | { ok: true; guarded: boolean }
  | {
      ok: false;
      why: 'dns' | 'unreachable' | 'no-conch' | 'elsewhere' | 'host';
      problem: AddressProblem;
    };

/**
 * Does the name lead to this Conch through the person's own tunnel or web server
 * (`via: 'proxy'`)? The gateway serves the token itself, on its own port, so a
 * match means the record, the proxy and where it points all lead here.
 *
 * A proxy that asks for its own sign-in first (Cloudflare Access, an nginx
 * password) answers with a redirect or a 401/403 instead. Conch can't look
 * through it, and shouldn't: that's a lock in front, said as `guarded`.
 */
export async function checkThrough(
  name: string,
  deps: {
    /** Where the gateway looks answers up. */
    checks: Map<string, string>;
    /** Where the proxy should send requests: `http://127.0.0.1:4317`. */
    target: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<ThroughResult> {
  const nonce = randomBytes(16).toString('base64url');
  const token = randomBytes(24).toString('base64url');
  deps.checks.set(nonce, token);
  const pointAt = `Point it at ${deps.target}.`;
  try {
    const response = await (deps.fetch ?? fetch)(
      `https://${name}/.well-known/conch-check/${nonce}`,
      { redirect: 'manual', signal: AbortSignal.timeout(deps.timeoutMs ?? 8000) },
    );
    const status = response.status;
    const body = status === 200 ? (await response.text()).trim() : '';
    if (body === token) return { ok: true, guarded: false };
    // This Conch answered, but under another name: the proxy didn't pass on the one people typed.
    if (body === 'wrong-host')
      return {
        ok: false,
        why: 'host',
        problem: {
          kind: 'other',
          message: `${name} reaches Conch, but your web server doesn’t pass on the name people typed, so Conch can’t keep sign-in safe there. Keep the Host header (in nginx: proxy_set_header Host $host;).`,
        },
      };
    if ((status >= 300 && status < 400) || status === 401 || status === 403)
      return { ok: true, guarded: true };
    // 502–504, and Cloudflare's 520–530: the proxy answered, but Conch didn't answer it.
    if (status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530))
      return {
        ok: false,
        why: 'no-conch',
        problem: {
          kind: 'unreachable',
          message: `${name} reaches your tunnel or web server, but it can’t reach Conch. ${pointAt}`,
        },
      };
    return {
      ok: false,
      why: 'elsewhere',
      problem: {
        kind: 'dns',
        message: `${name} leads somewhere else, not to this Conch. Point your tunnel or web server at ${deps.target}.`,
      },
    };
  } catch (error) {
    const code = CODE(error);
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
      return {
        ok: false,
        why: 'dns',
        problem: {
          kind: 'dns',
          message: `${name} can’t be found yet. Add it where your tunnel or web server is set up; new names can take a few minutes to arrive.`,
        },
      };
    return {
      ok: false,
      why: 'unreachable',
      problem: {
        kind: 'unreachable',
        message: `Nothing answered at https://${name}. Check that your tunnel or web server is running, answers over HTTPS, and points at ${deps.target}.`,
      },
    };
  } finally {
    deps.checks.delete(nonce);
  }
}
