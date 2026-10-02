import { Badge, Button } from '@conch/nacre';
import { ListChecks } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { going, useTasks } from './queries';

/** Sidebar entry for Tasks: how many are working, and whether any need you. */
export function TasksLink({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useTasks();
  const navigate = useNavigate();
  const active = useLocation().pathname.startsWith('/tasks');
  const background = data?.tasks.filter((t) => t.kind === 'background') ?? [];
  const needs = background.filter((t) => t.status === 'needs-you').length;
  const working = background.filter(going).length;

  return (
    <Button
      variant={active ? 'soft' : 'ghost'}
      tone="neutral"
      block
      leadingIcon={<ListChecks />}
      trailing={
        needs > 0 ? (
          <Badge size="sm" tone="accent" variant="solid" aria-label={`${needs} need your OK`}>
            {needs}
          </Badge>
        ) : working > 0 ? (
          <Badge size="sm" tone="neutral" aria-label={`${working} working`}>
            {working}
          </Badge>
        ) : undefined
      }
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        void navigate('/tasks');
        onNavigate?.();
      }}
      style={{ justifyContent: 'flex-start' }}
    >
      Tasks
    </Button>
  );
}
