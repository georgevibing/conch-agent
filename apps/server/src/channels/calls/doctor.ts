/**
 * Phone calls in Repair everything (AGENTS.md agreement 12, ADR 0138): with
 * calls off it says nothing; on, the number must be reachable for them, and
 * Twilio must be able to reach Conch. Nothing here is fixed by itself: the
 * channel's own connection points the number, and the door repairs itself.
 */
import { PHONE_CALL_CHANNELS, type ChannelDoor, type DoctorItem } from '@conch/protocol';

import type { DoctorCheck } from '../../doctor/service';
import type { ChannelService } from '../service';

export function phoneCallsCheck(
  channels: Pick<ChannelService, 'list'>,
  door: () => ChannelDoor,
): DoctorCheck {
  const base = { id: 'phone-calls', group: 'Talk to me here', title: 'Phone calls' };
  return {
    ...base,
    async run() {
      const items: DoctorItem[] = [];
      const { channels: all } = await channels.list();
      for (const channel of all) {
        const calls = channel.settings.calls;
        if (!PHONE_CALL_CHANNELS.includes(channel.kind) || !channel.enabled) continue;
        if (!calls?.answer && !calls?.approvals) continue;
        const item = (rest: Omit<DoctorItem, 'id' | 'group' | 'title'>) =>
          items.push({
            ...base,
            id: `phone-calls-${channel.id}`,
            title: `Phone calls on ${channel.bot.name}`,
            ...rest,
          });
        if (door().state !== 'ready')
          item({
            state: 'needs-you',
            message: 'Calls are on, but Twilio can’t reach Conch: its public address is off.',
            action: { kind: 'open', label: 'Turn it on', place: 'channels', focus: channel.id },
          });
        else if (!channel.people.length)
          item({
            state: 'needs-you',
            message: 'Calls are on, but Conch doesn’t know your number yet. Text it hello first.',
            action: { kind: 'open', label: 'Open', place: 'channels', focus: channel.id },
          });
        else if (channel.health.state !== 'online')
          item({
            state: 'needs-you',
            message: channel.health.message ?? 'The number isn’t connected right now.',
            action: { kind: 'open', label: 'Open', place: 'channels', focus: channel.id },
          });
        else item({ state: 'ok', message: 'Ready for calls.' });
      }
      return items;
    },
  };
}
