import { STANDING_ORDER_POWER_NOTE, standingOrderKind, standingOrderPower } from '@conch/protocol';
import { StandingOrderOffer } from '@conch/nacre';
import { useNavigate } from 'react-router';

import { checkInApi, useOrderChange, useStandingOrders } from './api';
import styles from './CheckIns.module.css';

/**
 * The card a suggested standing order leaves in its chat (ADR 0107): live, so
 * it shows what the person decided, here or on the Routines page. Keep it is
 * the only way a suggestion becomes an order.
 */
export function StandingOrderChatCard({ orderId, text }: { orderId: string; text: string }) {
  const { data, isPending } = useStandingOrders();
  const navigate = useNavigate();
  const keep = useOrderChange(
    () => checkInApi.change(orderId, { state: 'on' }),
    'Couldn’t keep that.',
  );
  const dismiss = useOrderChange(() => checkInApi.remove(orderId), 'Couldn’t put that away.');
  if (isPending) return null;
  const order = data?.orders.find((o) => o.id === orderId);
  const words = order?.text ?? text;
  return (
    <div className={styles.chatCard}>
      <StandingOrderOffer
        text={words}
        kind={order?.kind ?? standingOrderKind(words)}
        power={order?.power ?? standingOrderPower(words)}
        powerNote={STANDING_ORDER_POWER_NOTE}
        state={!order ? 'dismissed' : order.state === 'draft' ? 'offered' : 'kept'}
        busy={keep.isPending || dismiss.isPending}
        onKeep={() => keep.mutate(undefined)}
        onDismiss={() => dismiss.mutate(undefined)}
        onOpen={() => void navigate('/routines?checkin=1')}
      />
    </div>
  );
}
