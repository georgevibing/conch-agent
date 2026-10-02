import { Badge, Button } from '@conch/nacre';
import { KeyRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { useVault } from './queries';

/** Sidebar entry for Passwords, with a count when one is in a data breach. */
export function PasswordsLink({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useVault();
  const navigate = useNavigate();
  const active = useLocation().pathname.startsWith('/passwords');
  const breached = data?.status.health.compromised ?? 0;
  return (
    <Button
      variant={active ? 'soft' : 'ghost'}
      tone="neutral"
      block
      leadingIcon={<KeyRound />}
      trailing={
        breached > 0 ? (
          <Badge size="sm" tone="danger" variant="solid">
            {breached}
          </Badge>
        ) : undefined
      }
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        void navigate('/passwords');
        onNavigate?.();
      }}
      style={{ justifyContent: 'flex-start' }}
    >
      Passwords
      {breached > 0 && (
        <span className="nc-visually-hidden">
          , {breached === 1 ? '1 is' : `${breached} are`} in a data breach
        </span>
      )}
    </Button>
  );
}
