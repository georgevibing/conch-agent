import { Badge, Button } from '@conch/nacre';
import { Repeat } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { useRoutines } from './queries';

/** Sidebar entry for Routines, with a count of those that need you. */
export function RoutinesLink({ onNavigate }: { onNavigate?: () => void }) {
  const { data: routines } = useRoutines();
  const navigate = useNavigate();
  const active = useLocation().pathname.startsWith('/routines');
  const attention =
    routines?.filter(
      (r) =>
        r.status === 'draft' ||
        (r.status === 'active' &&
          (r.lastRun?.status === 'needs-you' || r.lastRun?.status === 'failed')),
    ).length ?? 0;

  return (
    <Button
      variant={active ? 'soft' : 'ghost'}
      tone="neutral"
      block
      leadingIcon={<Repeat />}
      trailing={
        attention > 0 ? (
          <Badge size="sm" tone="accent" variant="solid" aria-label={`${attention} need attention`}>
            {attention}
          </Badge>
        ) : undefined
      }
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        void navigate('/routines');
        onNavigate?.();
      }}
      style={{ justifyContent: 'flex-start' }}
    >
      Routines
    </Button>
  );
}
