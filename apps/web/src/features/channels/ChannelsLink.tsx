import { Badge, Button } from '@conch/nacre';
import { MessagesSquare } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { needsYou } from './describe';
import { useChannels } from './queries';

/** Sidebar entry for Channels, with a count of the ones that need you (a request, a broken key). */
export function ChannelsLink({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useChannels();
  const navigate = useNavigate();
  const active = useLocation().pathname.startsWith('/channels');
  const waiting = data?.channels.filter(needsYou).length ?? 0;

  return (
    <Button
      variant={active ? 'soft' : 'ghost'}
      tone="neutral"
      block
      leadingIcon={<MessagesSquare />}
      trailingIcon={
        waiting > 0 ? (
          <Badge tone="info" variant="solid">
            {waiting}
          </Badge>
        ) : undefined
      }
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        void navigate('/channels');
        onNavigate?.();
      }}
      style={{ justifyContent: 'flex-start' }}
    >
      Channels
      {waiting > 0 && (
        <span className="nc-visually-hidden">
          , {waiting === 1 ? '1 needs' : `${waiting} need`} you
        </span>
      )}
    </Button>
  );
}
