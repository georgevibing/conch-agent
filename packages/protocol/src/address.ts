/**
 * Your own address (ADR 0064): Conch answering at a domain or subdomain you
 * own, over HTTPS, with a certificate it gets and renews by itself.
 */
import { z } from 'zod';

export const AddressState = z.enum(['off', 'checking', 'getting-certificate', 'ready', 'problem']);
export type AddressState = z.infer<typeof AddressState>;

export const AddressProblemKind = z.enum([
  /** The name doesn't lead to this server (no record, or another server's). */
  'dns',
  /** Port 80 or 443 can't be reached from the internet (a firewall). */
  'unreachable',
  /** Conch may not listen on ports 80 and 443 (Linux, without the capability). */
  'ports-privilege',
  /** Another program already listens on port 80 or 443. */
  'ports-taken',
  /** Let's Encrypt has handed out as many certificates for it as it allows for now. */
  'rate-limited',
  /** The domain's CAA records don't allow Let's Encrypt. */
  'caa',
  /** Let's Encrypt won't issue for that name. */
  'rejected',
  /** Let's Encrypt couldn't be reached, or had trouble. Passes by itself. */
  'ca-unavailable',
  /** Set up on another computer (a restored backup): only a person turns it on here. */
  'another-computer',
  'other',
]);
export type AddressProblemKind = z.infer<typeof AddressProblemKind>;

export const AddressProblem = z.object({
  kind: AddressProblemKind,
  /** One plain sentence: what happened, and what to do. */
  message: z.string(),
  /** A command only a person can run (with `sudo`), to copy. */
  command: z.string().optional(),
  /** When Conch tries again by itself. */
  retryAt: z.number().optional(),
});
export type AddressProblem = z.infer<typeof AddressProblem>;

export const AddressStatus = z.object({
  state: AddressState,
  name: z.string().optional(),
  /** Where Conch answers: `https://conch.example.com`. */
  url: z.string().optional(),
  certificate: z
    .object({ notAfter: z.number(), issuer: z.string(), renewsAt: z.number().optional() })
    .optional(),
  /** What stands in the way, or (with `ready`) why renewing hasn't worked yet. */
  problem: AddressProblem.optional(),
});
export type AddressStatus = z.infer<typeof AddressStatus>;

/** A record to add at the domain's provider, so the name points here. */
export const RecordAdvice = z.object({
  type: z.enum(['A', 'AAAA']),
  /** Relative to the domain, as most providers ask for it: `conch`, or `@` for the domain itself. */
  host: z.string(),
  /** The whole name, for providers that want it written out. */
  name: z.string(),
  value: z.string(),
});
export type RecordAdvice = z.infer<typeof RecordAdvice>;

/** Where a name points, for the person setting it up. */
export const DnsReport = z.object({
  name: z.string(),
  /** This server's own public addresses. */
  mine: z.object({ v4: z.string().optional(), v6: z.string().optional() }),
  found: z.object({ v4: z.array(z.string()), v6: z.array(z.string()) }),
  pointing: z.enum(['here', 'missing', 'cloudflare', 'elsewhere']),
  message: z.string(),
  advice: z.array(RecordAdvice),
});
export type DnsReport = z.infer<typeof DnsReport>;

/** A name as typed: `conch.example.com`, or `https://Conch.Example.com/`. */
export const AddressNameBody = z.object({ name: z.string().trim().min(1).max(300) }).strict();
export type AddressNameBody = z.infer<typeof AddressNameBody>;
