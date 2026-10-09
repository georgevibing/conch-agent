import { Globe, Link2, Sparkles } from 'lucide-react';

import { Badge, type BadgeProps } from '../../components/Badge';

export interface AppMadeBadgeProps extends Omit<BadgeProps, 'children' | 'tone' | 'icon'> {
  /**
   * Made in this Conch, added from someone else (the community), or added
   * from a link or a file: a provider or a chat app an app brings (ADR 0122).
   */
  kind: 'made' | 'community' | 'link';
}

const WORDS: Record<AppMadeBadgeProps['kind'], string> = {
  made: 'Made by you',
  community: 'From the community',
  link: 'Added from a link',
};

/**
 * Where an app on the Apps page came from (ADR 0061), in two words beside
 * its name: **Made by you**, **From the community**, or, for a provider or a
 * chat app an app brings, **Added from a link** (ADR 0122). Quiet: a fact,
 * not a warning.
 */
export function AppMadeBadge({ kind, size = 'sm', ...props }: AppMadeBadgeProps) {
  return (
    <Badge
      size={size}
      tone={kind === 'made' ? 'accent' : 'neutral'}
      icon={kind === 'made' ? <Sparkles /> : kind === 'link' ? <Link2 /> : <Globe />}
      {...props}
    >
      {WORDS[kind]}
    </Badge>
  );
}
