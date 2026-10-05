import { UpdateBanner } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';

import { useUi } from '../../app/ui';
import { updateKeys, updatesApi } from './api';
import { useUpdates } from './queries';

/** "0.3.0" reads as "0.3" in a sentence. */
const short = (version: string) => version.replace(/^(\d+\.\d+)\.0$/, '$1');

/**
 * A new release, said once at the top of the app (ADR 0051): "Conch 0.3 is
 * ready · What's new · Update". Put away, it isn't shown again for that
 * version, on any device.
 */
export function UpdateNotice({ className }: { className?: string }) {
  const { data: status } = useUpdates();
  const client = useQueryClient();
  const openUpdate = useUi((s) => s.openUpdate);
  const conch = status?.conch;
  const latest = conch?.latest;
  if (!conch?.announce || !latest || conch.running) return null;
  return (
    <div className={className}>
      <UpdateBanner
        title={`Conch ${short(latest.version)} is ready`}
        onWhatsNew={() => openUpdate()}
        onUpdate={() => openUpdate({ start: true })}
        onDismiss={() =>
          void updatesApi
            .setSettings({ dismiss: latest.version })
            .then((next) => client.setQueryData(updateKeys.status, next))
            .catch(() => undefined)
        }
      />
    </div>
  );
}
