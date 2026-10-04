import { BadgeCheck, Ban, Building2, ShieldAlert, Users } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Badge, type BadgeTone } from '../../components/Badge';
import type { MarketTrustLevel } from './types';

const LOOK: Record<
  MarketTrustLevel,
  { tone: BadgeTone; label: string; icon: typeof Users; about: string }
> = {
  official: {
    tone: 'success',
    label: 'Official',
    icon: Building2,
    about: 'Published by the company that makes the models, in its own repository.',
  },
  verified: {
    tone: 'info',
    label: 'Verified publisher',
    icon: BadgeCheck,
    about: 'The place it’s from vouches for who published it.',
  },
  community: {
    tone: 'neutral',
    label: 'Community',
    icon: Users,
    about: 'Anyone could have published it. Conch reads it before it’s added.',
  },
  flagged: {
    tone: 'warning',
    label: 'Flagged',
    icon: ShieldAlert,
    about: 'The place it’s from warns about it.',
  },
  blocked: {
    tone: 'danger',
    label: 'Blocked',
    icon: Ban,
    about: 'The place it’s from found harmful code in it. It can’t be added.',
  },
};

export interface MarketTrustBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  trust: MarketTrustLevel;
  size?: 'sm' | 'md';
}

/** What the place a skill comes from says about it, in a word (ADR 0072). */
export function MarketTrustBadge({ trust, size = 'sm', title, ...props }: MarketTrustBadgeProps) {
  const look = LOOK[trust];
  const Icon = look.icon;
  return (
    <Badge tone={look.tone} size={size} icon={<Icon />} title={title ?? look.about} {...props}>
      {look.label}
    </Badge>
  );
}

/** One sentence on what a trust level means, for a detail view. */
export const marketTrustAbout = (trust: MarketTrustLevel) => LOOK[trust].about;
