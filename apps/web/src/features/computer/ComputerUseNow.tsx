import { ComputerUseLive, PanelPresence } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAssistantName } from '../integrations/queries';
import styles from './ComputerUse.module.css';
import { computerUseApi, computerUseKeys, shotAddress, useComputerUseNow } from './useApps';

/**
 * Over the composer while this chat's turn uses the computer (ADR 0110): the
 * latest look at the screen, what it's doing, and Stop. Asked only while the
 * turn runs; it goes the moment the turn lets go of the computer.
 */
export function ComputerUseNowCard({
  conversationId,
  running,
}: {
  conversationId?: string;
  running: boolean;
}) {
  const name = useAssistantName();
  const client = useQueryClient();
  const { data } = useComputerUseNow(running && Boolean(conversationId));
  const [stopping, setStopping] = useState(false);
  const active =
    running && data?.active && data.active.conversationId === conversationId
      ? data.active
      : undefined;
  return (
    <PanelPresence open={Boolean(active)} side="bottom">
      {active && (
        <ComputerUseLive
          className={styles.live}
          name={name}
          label={active.label}
          steps={active.steps}
          maxSteps={active.maxSteps}
          shot={shotAddress(active.shot)}
          stopKeys={data?.stopKeys}
          stopping={stopping}
          onStop={() => {
            setStopping(true);
            void computerUseApi
              .stop()
              .catch(() => undefined)
              .finally(() => {
                setStopping(false);
                void client.invalidateQueries({ queryKey: computerUseKeys.now });
              });
          }}
        />
      )}
    </PanelPresence>
  );
}
