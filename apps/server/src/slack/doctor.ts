import type { Doctor } from '../doctor/service';
import type { SlackService } from './service';

/** Repair everything looks at Slack too: is the sign-in still good? (AGENTS.md agreement 12) */
export function registerSlackDoctor(doctor: Doctor, slack: SlackService) {
  doctor.register({
    id: 'slack',
    group: 'Integrations',
    title: 'Slack',
    async run({ repair }) {
      const before = await slack.status();
      if (!before.connected || !before.enabled) return [];
      const after = repair ? await slack.check() : before;
      const state = after.health.state;
      const fine = state === 'ok' || state === 'checking';
      return [
        {
          id: 'slack',
          group: 'Integrations',
          title: before.workspace ? `Slack · ${before.workspace}` : 'Slack',
          state: fine
            ? repair && before.health.state !== 'ok' && state === 'ok'
              ? ('fixed' as const)
              : ('ok' as const)
            : ('needs-you' as const),
          message: fine
            ? 'Connected to Conch, so it works with every model.'
            : (after.health.message ?? 'Slack needs a look.'),
          ...(!fine && {
            action: {
              kind: 'open' as const,
              label: state === 'needs-auth' ? 'Connect Slack again' : 'Open Slack',
              place: 'integrations' as const,
            },
          }),
        },
      ];
    },
  });
}
