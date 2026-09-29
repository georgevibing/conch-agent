import { Badge, Button } from '@conch/nacre';
import { Blocks } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { isBroken } from './describe';
import { useIntegrations } from './queries';

/** Sidebar entry for Integrations, with a count of the ones that need you. */
export function IntegrationsLink({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useIntegrations();
  const navigate = useNavigate();
  const active = useLocation().pathname.startsWith('/integrations');
  const broken = data?.integrations.filter(isBroken).length ?? 0;

  return (
    <Button
      variant={active ? 'soft' : 'ghost'}
      tone="neutral"
      block
      leadingIcon={<Blocks />}
      trailingIcon={
        broken > 0 ? (
          <Badge tone="warning" variant="solid">
            {broken}
          </Badge>
        ) : undefined
      }
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        void navigate('/integrations');
        onNavigate?.();
      }}
      style={{ justifyContent: 'flex-start' }}
    >
      Integrations
      {broken > 0 && (
        <span className="nc-visually-hidden">
          , {broken === 1 ? '1 needs' : `${broken} need`} attention
        </span>
      )}
    </Button>
  );
}
