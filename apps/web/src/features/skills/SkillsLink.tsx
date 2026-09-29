import { Button } from '@conch/nacre';
import { Sparkles } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

/** Sidebar entry for Skills. */
export function SkillsLink({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const active = useLocation().pathname.startsWith('/skills');
  return (
    <Button
      variant={active ? 'soft' : 'ghost'}
      tone="neutral"
      block
      leadingIcon={<Sparkles />}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        void navigate('/skills');
        onNavigate?.();
      }}
      style={{ justifyContent: 'flex-start' }}
    >
      Skills
    </Button>
  );
}
