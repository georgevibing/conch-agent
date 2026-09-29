import { AlertTriangle, Check, CircleSlash, KeyRound, TriangleAlert } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Badge, type BadgeTone } from '../../components/Badge';
import { Spinner } from '../../components/Spinner';

/** Mirrors `HealthState` in `@conch/protocol`. */
export type IntegrationStateValue =
  'ok' | 'checking' | 'connecting' | 'needs-auth' | 'warning' | 'error' | 'off';

export interface IntegrationStateMeta {
  label: string;
  tone: BadgeTone;
  icon: ReactNode;
  /** Needs the user to do something. */
  attention: boolean;
}

/** Plain words for every state an integration can be in. */
export const integrationStateMeta: Record<IntegrationStateValue, IntegrationStateMeta> = {
  ok: { label: 'Working', tone: 'success', icon: <Check />, attention: false },
  checking: {
    label: 'Checking…',
    tone: 'info',
    icon: <Spinner size="xs" label={null} />,
    attention: false,
  },
  connecting: {
    label: 'Signing in…',
    tone: 'info',
    icon: <Spinner size="xs" label={null} />,
    attention: false,
  },
  'needs-auth': { label: 'Needs sign-in', tone: 'warning', icon: <KeyRound />, attention: true },
  warning: { label: 'Check this', tone: 'warning', icon: <TriangleAlert />, attention: true },
  error: { label: 'Not working', tone: 'danger', icon: <AlertTriangle />, attention: true },
  off: { label: 'Off', tone: 'neutral', icon: <CircleSlash />, attention: false },
};

export interface IntegrationStatusBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  state: IntegrationStateValue;
  size?: 'sm' | 'md';
}

/** The state as a small badge with an icon, e.g. "Needs sign-in". */
export function IntegrationStatusBadge({
  state,
  size = 'sm',
  ...props
}: IntegrationStatusBadgeProps) {
  const meta = integrationStateMeta[state];
  return (
    <Badge tone={meta.tone} size={size} icon={meta.icon} {...props}>
      {meta.label}
    </Badge>
  );
}
