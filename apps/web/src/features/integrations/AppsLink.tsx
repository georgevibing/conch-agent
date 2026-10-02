import { Badge, Button } from '@conch/nacre';
import { Blocks } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { needsYou } from '../channels/describe';
import { useChannels } from '../channels/queries';
import { isBroken } from './describe';
import { APPS_PATH, isPinnedId } from './paths';
import { useIntegrations } from './queries';

/**
 * Sidebar entry for Apps (ADR 0052), with a count of what needs you: an app
 * that stopped working, a chat app with someone waiting or a hello to finish.
 */
export function AppsLink({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useIntegrations();
  const { data: channels } = useChannels();
  const navigate = useNavigate();
  const path = useLocation().pathname;
  const active =
    path === APPS_PATH ||
    (path.startsWith(`${APPS_PATH}/`) && !isPinnedId(path.split('/')[2])) ||
    path.startsWith('/channels');
  const broken = data?.integrations.filter(isBroken).length ?? 0;
  const waiting = channels?.channels.filter(needsYou).length ?? 0;
  const count = broken + waiting;

  return (
    <Button
      variant={active ? 'soft' : 'ghost'}
      tone="neutral"
      block
      leadingIcon={<Blocks />}
      trailingIcon={
        count > 0 ? (
          <Badge tone={broken ? 'warning' : 'info'} variant="solid">
            {count}
          </Badge>
        ) : undefined
      }
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        void navigate(APPS_PATH);
        onNavigate?.();
      }}
      style={{ justifyContent: 'flex-start' }}
    >
      Apps
      {count > 0 && (
        <span className="nc-visually-hidden">
          , {count === 1 ? '1 needs' : `${count} need`} you
        </span>
      )}
    </Button>
  );
}
