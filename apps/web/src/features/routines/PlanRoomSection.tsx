import { PLAN_ROOM_DEFAULT } from '@conch/protocol';
import { PlanRoom } from '@conch/nacre';

import { useRoutineSpending, useSetPlanRoom } from './queries';

/**
 * Room for your own chats (ADR 0057): when routines on a plan wait for it to
 * reset, or never. The choice shows at once; the save follows. A person's
 * choice: the assistant has no way to change it.
 */
export function PlanRoomSection({
  headingLevel = 2,
  className,
  id,
}: {
  headingLevel?: 2 | 3;
  className?: string;
  id?: string;
}) {
  const { data: spending } = useRoutineSpending();
  const save = useSetPlanRoom();
  const saved =
    spending?.planRoomPercent === undefined ? PLAN_ROOM_DEFAULT : spending.planRoomPercent;
  // The choice on screen at once; what's saved once it is (or again, if it couldn't be).
  const percent = save.isPending ? save.variables : saved;
  if (!spending) return null;
  return (
    <PlanRoom
      percent={percent}
      onChange={(next) => save.mutate(next)}
      plans={spending.plans ?? []}
      defaultPercent={PLAN_ROOM_DEFAULT}
      headingLevel={headingLevel}
      {...(className && { className })}
      {...(id && { id })}
    />
  );
}
