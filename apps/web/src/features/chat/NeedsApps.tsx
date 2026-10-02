import type { AppsModel } from '@conch/protocol';
import { ModelSwitchCard, toast } from '@conch/nacre';
import { useMutation } from '@tanstack/react-query';

import { api } from '../../api/client';
import { useUi } from '../../app/ui';
import type { TranscriptItem } from '../../live/reducer';
import { useIntegrations } from '../integrations/queries';
import styles from './Transcript.module.css';

/**
 * The chat's model can't use what a message needs (ADR 0050). The message
 * waits here: one press switches the chat to the best model you already set
 * up that can, and it goes by itself; or it's answered without. With none
 * that can, the next step is connecting a provider.
 */
export function NeedsAppsItem({
  item,
  conversationId,
}: {
  item: Extract<TranscriptItem, { kind: 'needs-apps' }>;
  conversationId?: string;
}) {
  const { data } = useIntegrations();
  const openSettings = useUi((s) => s.openSettings);
  const release = useMutation({
    mutationFn: (to: AppsModel | undefined) =>
      api.releaseTurn(conversationId ?? '', to?.engine, to?.model),
    onError: (error: Error) => toast.error(error.message),
  });
  const { switchTo } = item;
  const waiting = !item.settled && conversationId;
  return (
    <div className={styles.aside}>
      <ModelSwitchCard
        model={item.model.label}
        needs={item.needs.map((need) => ({
          name: need.name,
          kind: need.kind,
          ...(need.catalogId && {
            brand: need.catalogId,
            color: data?.catalog.find((c) => c.id === need.catalogId)?.color,
          }),
        }))}
        state={item.settled ?? 'offer'}
        switchTo={
          switchTo && {
            label: switchTo.label,
            // Another provider is worth naming; the chat's own goes without saying.
            ...(switchTo.engine !== item.model.engine && { provider: switchTo.provider }),
          }
        }
        busy={release.isPending}
        onSwitch={waiting && switchTo ? () => release.mutate(switchTo) : undefined}
        onConnect={() => openSettings('providers')}
        onAnswerWithout={waiting ? () => release.mutate(undefined) : undefined}
      />
    </div>
  );
}
