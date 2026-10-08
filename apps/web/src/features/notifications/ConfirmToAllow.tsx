import { useEffect, useRef } from 'react';

import { ApiError } from '../../api/client';
import { useLive } from '../../live/LiveProvider';
import { useLiveStore } from '../../live/store';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';

/**
 * A step that matters, allowed from a chat's own card on a device that isn't
 * the computer Conch runs on (ADR 0108): the gateway holds it back until you
 * confirm it's you, as the approval sheet does. This asks, with your passkey
 * or password, right there, then sends the same answer again. Cancelled, the
 * card simply waits again.
 */
export function ConfirmToAllow() {
  const stepUp = useLiveStore((s) => s.stepUp);
  const live = useLive();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const asked = useRef<string>(undefined);

  useEffect(() => {
    if (!stepUp || asked.current === stepUp.permissionId) return;
    asked.current = stepUp.permissionId;
    const { conversationId, permissionId, decision, edit, message } = stepUp;
    let first = true;
    void guard(async () => {
      // The gateway already said it needs you to confirm: ask, then send it again.
      if (first) {
        first = false;
        throw new ApiError(403, 'verify-required', message);
      }
      live.respond(conversationId, permissionId, decision, edit);
    })
      .catch(() => undefined)
      .finally(() => {
        asked.current = undefined;
        useLiveStore.getState().clearStepUp();
      });
  }, [stepUp, guard, live]);

  return dialog;
}
