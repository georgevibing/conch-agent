/**
 * Your own address against a real ACME server: Let's Encrypt's Pebble, with
 * its DNS test server pointing every name at this computer. Skipped unless
 * `CONCH_PEBBLE=1`. To run it (Docker):
 *
 *   docker network create conch-pebble
 *   docker run -d --name conch-challtestsrv --network conch-pebble \
 *     ghcr.io/letsencrypt/pebble-challtestsrv -defaultIPv6 "" -defaultIPv4 <this computer, as containers see it>
 *   docker run -d --name conch-pebble-ca --network conch-pebble -p 14000:14000 -e PEBBLE_VA_NOSLEEP=1 \
 *     ghcr.io/letsencrypt/pebble -config test/config/pebble-config.json -dnsserver conch-challtestsrv:8053
 *   docker cp conch-pebble-ca:/test/certs/pebble.minica.pem /tmp/pebble.minica.pem
 *   CONCH_PEBBLE=1 CONCH_PEBBLE_CA=/tmp/pebble.minica.pem pnpm --filter @conch/server exec vitest run src/address/pebble.test.ts
 *
 * Pebble checks `http-01` on port 5002, so Conch's port 80 listener is there.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:tls';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { AcmeClient } from './acme';
import { AddressService } from './service';

const NAME = 'conch.example.com';
const run = process.env.CONCH_PEBBLE === '1';

/** `fetch`, trusting Pebble's own CA (its API is HTTPS with a test certificate). */
function fetchTrusting(ca: string): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(String(input));
      const req = request(
        url,
        {
          method: init?.method ?? 'GET',
          headers: init?.headers as Record<string, string> | undefined,
          ca,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers))
              if (typeof v === 'string') headers.set(k, v);
              else if (Array.isArray(v)) for (const each of v) headers.append(k, each);
            const status = res.statusCode ?? 0;
            resolve(
              new Response(
                status === 204 || init?.method === 'HEAD' ? null : Buffer.concat(chunks),
                {
                  status,
                  headers,
                },
              ),
            );
          });
        },
      );
      req.on('error', reject);
      req.end(typeof init?.body === 'string' ? init.body : undefined);
    })) as typeof fetch;
}

describe.skipIf(!run)('your own address, against Pebble', () => {
  it('gets a real certificate over http-01 and serves it on HTTPS', async () => {
    const ca = readFileSync(process.env.CONCH_PEBBLE_CA ?? '/tmp/pebble.minica.pem', 'utf8');
    const directoryUrl = process.env.CONCH_PEBBLE_DIRECTORY ?? 'https://localhost:14000/dir';
    const home = await mkdtemp(join(tmpdir(), 'conch-pebble-'));
    const app = Fastify();
    app.get('/api/hello', () => ({ hello: 'from the gateway' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const service = new AddressService({
      home,
      config: { CONCH_HTTPS_PORT: 8443, CONCH_HTTP_PORT: 5002, CONCH_ACME_DIRECTORY: directoryUrl },
      gateway: () => app.server,
      acme: (accountKey) => new AcmeClient({ directoryUrl, accountKey, fetch: fetchTrusting(ca) }),
      // Pebble's DNS points every name here; the real check would ask the internet.
      reach: async () => ({ ok: true }),
    });
    try {
      const status = await service.set(NAME);
      expect(status.problem).toBeUndefined();
      expect(status).toMatchObject({ state: 'ready', name: NAME, url: `https://${NAME}:8443` });
      expect(status.certificate?.issuer).toMatch(/Pebble/);

      const peer = await new Promise<{ subject: string; issuer: string }>((resolve, reject) => {
        const socket = connect(
          { host: '127.0.0.1', port: 8443, servername: NAME, rejectUnauthorized: false },
          () => {
            const cert = socket.getPeerCertificate();
            resolve({ subject: cert.subjectaltname ?? '', issuer: String(cert.issuer.CN ?? '') });
            socket.destroy();
          },
        );
        socket.on('error', reject);
      });
      // Pebble, like Let's Encrypt's newer profiles, names it only in the SAN.
      expect(peer.subject).toBe(`DNS:${NAME}`);
      expect(peer.issuer).toMatch(/Pebble Intermediate/);

      // Pebble offers renewal information (RFC 9773): Conch plans by it.
      expect(status.certificate?.renewsAt).toBeGreaterThan(Date.now());
      // Renewing replaces the certificate it has, and keeps answering.
      const first = await service.store.certificate();
      const renewed = await service.renew();
      expect(renewed).toMatchObject({ state: 'ready' });
      expect(renewed.problem).toBeUndefined();
      expect((await service.store.certificate())?.certPem).not.toBe(first?.certPem);
    } finally {
      await service.stop();
      await app.close();
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);
});
