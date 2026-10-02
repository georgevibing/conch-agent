import type { Doctor } from '../doctor/service';
import type { GoogleService } from './service';
export function registerGoogleDoctor(doctor: Doctor, google: GoogleService) {
  doctor.register({
    id: 'google',
    group: 'Integrations',
    title: 'Google accounts',
    async run({ repair, signal }) {
      const before = await google.status();
      if (!before.configured) return [];
      if (repair)
        for (const account of before.accounts) {
          if (signal.aborted) break;
          await google.check(account.id);
        }
      const after = await google.status();
      return after.accounts.map((account) => ({
        id: `google:${account.id}`,
        group: 'Integrations',
        title: `Google · ${account.email}`,
        state:
          account.state === 'ready'
            ? repair && before.accounts.find((a) => a.id === account.id)?.state !== 'ready'
              ? ('fixed' as const)
              : ('ok' as const)
            : ('needs-you' as const),
        message: account.message ?? 'Connected directly to Conch.',
        ...(account.state !== 'ready'
          ? {
              action: {
                kind: 'open' as const,
                label: 'Reconnect Google',
                place: 'integrations' as const,
              },
            }
          : {}),
      }));
    },
  });
}
