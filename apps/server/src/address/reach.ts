/**
 * Does the name lead here, from the outside? (ADR 0064)
 *
 * Before asking a certificate authority (whose failures count against its
 * limits), Conch serves a random token on its port 80 listener and fetches
 * it through the name. Only this Conch knows the token, so an answer that
 * matches means the record, the firewall and the port all lead here.
 */
import { randomBytes } from 'node:crypto';

import { FIREWALL_HINT, type AddressProblem } from './problems';

export type ReachResult =
  | { ok: true }
  | { ok: false; why: 'dns' | 'refused' | 'timeout' | 'elsewhere'; problem: AddressProblem };

const CODE = (error: unknown): string => {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code ?? (error as { code?: string }).code ?? (error as Error).name;
};

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
    const response = await (deps.fetch ?? fetch)(
      `http://${name}${port}/.well-known/conch-check/${nonce}`,
      { redirect: 'manual', signal: AbortSignal.timeout(deps.timeoutMs ?? 8000) },
    );
    const body = response.ok ? (await response.text()).trim() : '';
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
