/**
 * Repair everything's look at your own address (ADR 0064): the certificate,
 * where the name points, the ports, and (on Linux) whether Conch may still
 * answer on them. A repair renews or reopens what it can; what only a person
 * can do comes back as one action. Through a tunnel or web server of the
 * person's own, it looks through it again: that's all Conch can mend there.
 */
import type { DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../doctor/service';
import type { AddressService, AddressStatus } from './service';

const GROUP = 'This computer';
const TITLE = 'Your address';
const ID = 'address:main';
const DAY = 24 * 60 * 60 * 1000;

function item(
  state: DoctorItem['state'],
  message: string,
  action?: DoctorItem['action'],
): DoctorItem {
  return { id: ID, group: GROUP, title: TITLE, state, message, ...(action && { action }) };
}

function describe(status: AddressStatus, now: number, repaired: boolean): DoctorItem[] {
  const name = status.name ?? 'Your address';
  const problem = status.problem;
  if (status.state === 'off') return [];
  if (status.via === 'proxy' && problem?.kind !== 'another-computer') {
    if (status.state === 'ready')
      return [
        item(
          repaired ? 'fixed' : 'ok',
          repaired
            ? `${name} reaches Conch through your tunnel or web server again.`
            : `Conch answers at ${status.url ?? name}, through your tunnel or web server.`,
        ),
      ];
    if (status.state === 'checking')
      return [item('info', `Conch is checking the way in through ${name}.`)];
    return [
      item('needs-you', problem?.message ?? `${name} doesn’t reach Conch yet.`, {
        kind: 'open',
        label: 'Open Security',
        place: 'security',
      }),
    ];
  }
  if (problem?.kind === 'another-computer')
    return [
      item('needs-you', problem.message, {
        kind: 'open',
        label: 'Turn on here',
        place: 'security',
      }),
    ];
  if (status.state === 'ready' && status.certificate) {
    const days = Math.floor((status.certificate.notAfter - now) / DAY);
    if (problem && days < 7)
      return [
        item(
          problem.command ? 'needs-you' : 'warning',
          `The certificate for ${name} runs out in ${days} day${days === 1 ? '' : 's'}, and renewing it hasn’t worked: ${problem.message}`,
          problem.command
            ? { kind: 'command', label: 'Copy the command', command: problem.command }
            : { kind: 'open', label: 'Open Security', place: 'security' },
        ),
      ];
    return [
      item(
        repaired ? 'fixed' : 'ok',
        repaired
          ? `Conch renewed the certificate for ${name}.`
          : `Conch answers at ${status.url ?? name}, with a certificate good for ${days} more day${days === 1 ? '' : 's'}.`,
      ),
    ];
  }
  if (status.state === 'checking' || status.state === 'getting-certificate')
    return [item('info', `Conch is getting ${name} ready.`)];
  if (problem?.command)
    return [
      item('needs-you', problem.message, {
        kind: 'command',
        label: 'Copy the command',
        command: problem.command,
      }),
    ];
  return [
    item(
      problem?.kind === 'ca-unavailable' || problem?.kind === 'rate-limited'
        ? 'warning'
        : 'needs-you',
      problem?.message ?? `${name} isn’t answering yet.`,
      { kind: 'open', label: 'Open Security', place: 'security' },
    ),
  ];
}

/** The `address` check, for the gateway's doctor. */
export function addressCheck(
  service: Pick<AddressService, 'status' | 'renew' | 'restart'>,
  now: () => number = Date.now,
): DoctorCheck {
  return {
    id: 'address',
    group: GROUP,
    title: TITLE,
    async run({ repair }) {
      const before = service.status();
      if (!repair || before.state === 'off' || before.problem?.kind === 'another-computer')
        return describe(before, now(), false);
      // Through a proxy: look through it again (renew does just that), and nothing more.
      if (before.via === 'proxy') {
        const after = before.state === 'ready' ? before : await service.renew();
        return describe(after, now(), before.state !== 'ready' && after.state === 'ready');
      }
      // Listeners that stopped come back first; then a certificate that's due, or missing.
      let after = before;
      if (
        before.state === 'problem' &&
        (before.problem?.kind === 'ports-taken' || before.problem?.kind === 'ports-privilege')
      )
        after = await service.restart();
      const days = after.certificate ? (after.certificate.notAfter - now()) / DAY : 0;
      const renewed = after.state !== 'ready' || days < 7 || Boolean(after.problem);
      if (renewed) after = await service.renew();
      const fixed =
        after.state === 'ready' &&
        !after.problem &&
        (before.state !== 'ready' || Boolean(before.problem));
      return describe(after, now(), fixed);
    },
  };
}
