import { Globe, Sparkles } from 'lucide-react';

import { Badge, type BadgeProps } from '../../components/Badge';

export interface AppMadeBadgeProps extends Omit<BadgeProps, 'children' | 'tone' | 'icon'> {
  /** Made in this Conch, or added from someone else. */
  kind: 'made' | 'community';
}

/**
 * Where an app on the Apps page came from (ADR 0061), in two words beside
 * its name: **Made by you**, or **From the community**. Quiet: a fact, not a
 * warning.
 */
export function AppMadeBadge({ kind, size = 'sm', ...props }: AppMadeBadgeProps) {
  return (
    <Badge
      size={size}
      tone={kind === 'made' ? 'accent' : 'neutral'}
      icon={kind === 'made' ? <Sparkles /> : <Globe />}
      {...props}
    >
      {kind === 'made' ? 'Made by you' : 'From the community'}
    </Badge>
  );
}
