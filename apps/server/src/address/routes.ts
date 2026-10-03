import { AddressNameBody, AddressStatus, DnsReport } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Gatekeeper } from '../security';
import type { AddressService } from './service';
import { AddressError, normaliseName } from './store';

/**
 * Your own address (ADR 0064), from Settings: a signed-in person. Turning it
 * on, changing it, turning it off and moving it here all need a fresh "confirm
 * it's you", and a device that's let in (or this computer): an address lets
 * the internet reach Conch.
 *
 * `conch setup` and `conch address` don't come here: they write
 * `address.json` themselves and read `address/status.json`, as `conch devices`
 * writes access.json (`AddressService.watch`). No key goes over the port.
 *
 * Setting a name answers at once with `checking`; what follows (the reach
 * check, the certificate) arrives as `address.changed` events and in `GET`.
 */
export function registerAddressRoutes(
  app: FastifyInstance,
  address: AddressService,
  gate: Gatekeeper,
): void {
  const status = () => AddressStatus.parse(address.status());

  /**
   * Only the owner in a browser: this computer, or a signed-in device that's
   * let in (when new devices need approving), who just confirmed it's them.
   * Never a script's access key: where Conch can be reached is a person's choice.
   */
  const owner = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = request.access?.kind === 'session' ? request.access.session : undefined;
    const allowed =
      gate.isLocal(request) ||
      (session !== undefined &&
        (!(await gate.store.approvalOn()) || (await gate.store.deviceApproved(session.deviceId))));
    if (!allowed) {
      void reply.code(403).send({
        error: 'approver-only',
        message: 'Change where Conch can be reached from Conch itself, on a device you’ve let in.',
      });
      return false;
    }
    if (!gate.verified(request.access)) {
      void reply.code(403).send({
        error: 'verify-required',
        message: 'Confirm it’s you to change where Conch can be reached.',
      });
      return false;
    }
    return true;
  };

  const name = (request: FastifyRequest, reply: FastifyReply) => {
    const body = AddressNameBody.safeParse(request.body);
    if (!body.success) {
      void reply.code(400).send({ error: 'bad-request', message: 'Which address?' });
      return undefined;
    }
    try {
      return normaliseName(body.data.name);
    } catch (error) {
      if (!(error instanceof AddressError)) throw error;
      void reply.code(400).send({ error: 'bad-name', message: error.message });
      return undefined;
    }
  };

  const routes = (
    base: string,
    guard: (r: FastifyRequest, p: FastifyReply) => Promise<boolean>,
  ) => {
    app.get(base, () => status());

    app.post(`${base}/dns`, async (request, reply) => {
      const wanted = name(request, reply);
      if (!wanted) return;
      return DnsReport.parse(await address.dns(wanted));
    });

    app.put(base, async (request, reply) => {
      const wanted = name(request, reply);
      if (!wanted) return;
      if (!(await guard(request, reply))) return;
      // The reach check and the certificate take a while: say "checking" now, the rest as events.
      void address.set(wanted).catch(() => undefined);
      await new Promise((resolve) => setImmediate(resolve));
      return status();
    });

    app.delete(base, async (request, reply) => {
      if (!(await guard(request, reply))) return;
      return AddressStatus.parse(await address.remove());
    });

    // Renewing spends Let's Encrypt's limits, so it's the owner's to ask for too.
    app.post(`${base}/renew`, async (request, reply) => {
      if (!(await guard(request, reply))) return;
      void address.renew().catch(() => undefined);
      await new Promise((resolve) => setImmediate(resolve));
      return status();
    });

    /** A backup brought it from another computer: only a person turns it on here. */
    app.post(`${base}/here`, async (request, reply) => {
      if (!(await guard(request, reply))) return;
      void address.turnOnHere().catch(() => undefined);
      await new Promise((resolve) => setImmediate(resolve));
      return status();
    });
  };

  routes('/api/address', owner);
}
