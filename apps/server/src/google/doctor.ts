import type { Doctor } from '../doctor/service';
import type { GoogleApps } from './apps';
import type { GoogleService } from './service';

/**
 * Gmail, Google Calendar and Google Drive in Repair everything, one line per
 * app, like every other app in Apps (ADR 0048). Repair checks
 * each account they use again: that renews a Google sign-in and retries what
 * passes. A refused app password or a revoked sign-in is the person's to fix.
 */
export function registerGoogleDoctor(doctor: Doctor, google: GoogleService, apps?: GoogleApps) {
  doctor.register({
    id: 'google',
    group: 'Apps',
    title: 'Google apps',
    async run({ repair, signal }) {
      const before = await google.status();
      if (!before.accounts.length)
        return before.configured
          ? [
              {
                id: 'google:setup',
                group: 'Apps',
                title: 'Google apps',
                state: 'needs-you' as const,
                message: 'Your Google app is saved. Sign in to connect an account.',
                action: {
                  kind: 'open' as const,
                  label: 'Connect Google',
                  place: 'integrations' as const,
                },
              },
            ]
          : [];
      const was = new Map(before.accounts.map((a) => [a.id, a.state]));
      if (repair)
        for (const account of before.accounts) {
          if (signal.aborted) break;
          if (account.state !== 'ready') await google.check(account.id).catch(() => undefined);
        }
      if (!apps) return [];
      await apps.refresh();
      const after = await google.status();
      const fixed = new Set(
        after.accounts
          .filter((a) => repair && a.state === 'ready' && was.get(a.id) !== 'ready')
          .map((a) => a.email),
      );
      return (await apps.list())
        .filter((item) => item.enabled)
        .map((item) => {
          const base = {
            id: `integrations:${item.id}`,
            group: 'Apps',
            title: item.name,
          };
          const { health } = item;
          const healed = (item.account ?? '').split(', ').some((email) => fixed.has(email));
          if (health.state === 'ok')
            return {
              ...base,
              state: healed ? ('fixed' as const) : ('ok' as const),
              message: healed
                ? 'Working again.'
                : `Working${item.account ? ` · ${item.account}` : ''}.`,
            };
          return {
            ...base,
            state: 'needs-you' as const,
            message: health.message ?? 'Not working.',
            action: {
              kind: 'open' as const,
              label: health.state === 'needs-auth' ? 'Sign in again' : 'Open',
              place: 'integrations' as const,
              focus: item.id,
            },
          };
        });
    },
  });
}
