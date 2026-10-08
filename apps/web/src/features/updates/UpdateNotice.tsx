import { UpdateBanner } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useUi } from '../../app/ui';
import { updateKeys, updatesApi } from './api';
import { useUpdates } from './queries';

/** "0.3.0" reads as "0.3" in a sentence. */
const short = (version: string) => version.replace(/^(\d+\.\d+)\.0$/, '$1');

declare const __CONCH_WEB_BUILT_AT__: string | null | undefined;

/** When this page's web app was built (`apps/web/vite.config.ts`); none in development. */
export const OWN_BUILD =
  typeof __CONCH_WEB_BUILT_AT__ === 'string' ? __CONCH_WEB_BUILT_AT__ : undefined;

const reloadPage = () => window.location.reload();

/**
 * A new release, said once at the top of the app (ADR 0051): "Conch 0.3 is
 * ready · What's new · Update". Put away, it isn't shown again for that
 * version, on any device.
 *
 * Before it: the web app was built again under this page (code pulled by
 * hand, ADR 0019), so "A newer Conch is ready · Reload". A page nobody is
 * looking at (a phone's Home Screen app in the background) reloads by itself
 * when it's next opened.
 */
export function UpdateNotice({
  className,
  ownBuild = OWN_BUILD,
  reload = reloadPage,
}: {
  className?: string;
  /** For tests: when this page was built. */
  ownBuild?: string;
  reload?: () => void;
}) {
  const { data: status } = useUpdates();
  const client = useQueryClient();
  const openUpdate = useUi((s) => s.openUpdate);
  const [putAway, setPutAway] = useState<string>();
  const served = status?.webBuilt;
  const newer = Boolean(ownBuild && served && served !== ownBuild);
  useEffect(() => {
    if (!newer) return;
    const back = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [newer, reload]);
  const conch = status?.conch;
  if (newer && served !== putAway)
    return (
      <div className={className}>
        <UpdateBanner
          title="A newer Conch is ready"
          updateLabel="Reload"
          onUpdate={reload}
          onDismiss={() => setPutAway(served)}
        />
      </div>
    );
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
