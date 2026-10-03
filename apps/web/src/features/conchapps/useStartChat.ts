import { useNavigate } from 'react-router';

import { useLive } from '../../live/LiveProvider';
import { useLiveStore } from '../../live/store';

/**
 * Start a new chat with these words and open it (as New routine does): the
 * new chat's page shows the message on its way, then follows the chat to its
 * own address once the gateway has made it.
 */
export function useStartChat() {
  const live = useLive();
  const navigate = useNavigate();
  return (text: string) => {
    const id = live.send(text);
    const off = useLiveStore.subscribe((s) => {
      const conversationId = s.created[id];
      if (conversationId) {
        off();
        void navigate(`/c/${conversationId}`);
      }
    });
    void navigate('/');
  };
}
