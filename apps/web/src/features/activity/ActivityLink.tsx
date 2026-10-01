import { Button } from '@conch/nacre';
import { History } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

/** Sidebar entry for Activity: everything the assistant did (ADR 0028). */
export function ActivityLink({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const active = useLocation().pathname.startsWith('/activity');
  return (
    <Button
      variant={active ? 'soft' : 'ghost'}
      tone="neutral"
      block
      leadingIcon={<History />}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        void navigate('/activity');
        onNavigate?.();
      }}
      style={{ justifyContent: 'flex-start' }}
    >
      Activity
    </Button>
  );
}
