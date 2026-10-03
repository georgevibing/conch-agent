/**
 * What can stand between Conch and its own address (ADR 0064), each said in
 * one plain sentence with the one thing to do next (AGENTS.md agreement 11).
 */

export type AddressProblemKind =
  /** The name doesn't lead to this server (no record, or another server's). */
  | 'dns'
  /** Port 80 or 443 can't be reached from the internet (a firewall). */
  | 'unreachable'
  /** Conch may not listen on ports 80 and 443 (Linux, without the capability). */
  | 'ports-privilege'
  /** Another program already listens on port 80 or 443. */
  | 'ports-taken'
  /** Let's Encrypt has handed out as many certificates for it as it allows for now. */
  | 'rate-limited'
  /** The domain's CAA records don't allow Let's Encrypt. */
  | 'caa'
  /** Let's Encrypt won't issue for that name. */
  | 'rejected'
  /** Let's Encrypt couldn't be reached, or had trouble. Passes by itself. */
  | 'ca-unavailable'
  /** Set up on another computer (a restored backup): only a person turns it on here. */
  | 'another-computer'
  | 'other';

export interface AddressProblem {
  kind: AddressProblemKind;
  /** One plain sentence: what happened, and what to do. */
  message: string;
  /** A command only a person can run (with `sudo`), to copy. */
  command?: string;
  /** When Conch tries again by itself. */
  retryAt?: number;
}

/** A problem as an error, so it can travel up through `await`. */
export class AddressProblemError extends Error {
  constructor(readonly problem: AddressProblem) {
    super(problem.message);
  }
}

export const FIREWALL_HINT =
  'That’s usually a firewall: the one on this server, or your server provider’s (Hetzner, AWS, Google Cloud, Azure, DigitalOcean and Oracle each have one in their dashboard). Let ports 80 and 443 in, then try again.';
