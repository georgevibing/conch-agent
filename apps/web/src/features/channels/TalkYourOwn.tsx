import { Button, Heading, MakeWithConch } from '@conch/nacre';
import { Link2 } from 'lucide-react';
import { useId, useState } from 'react';

import { useStartChat } from '../conchapps/useStartChat';
import { CustomDialog } from '../integrations/CustomDialog';
import styles from './Channels.module.css';

const EXAMPLES = ['Zulip', 'Threema', 'Revolt', 'Nextcloud Talk'];

/**
 * **Add your own** under Talk to me here (ADR 0122): any chat app, from its
 * name — Conch reads its bot docs, makes it, checks it with your bot's token
 * and shows a card — or **From a link**, one someone shared. No hub.
 */
export function TalkYourOwn() {
  const headingId = useId();
  const startChat = useStartChat();
  const [fromLink, setFromLink] = useState(false);
  return (
    <section aria-labelledby={headingId} className={styles.ownSection}>
      <Heading level={2} size="sm" tone="muted" id={headingId}>
        Not here? Add your own
      </Heading>
      <MakeWithConch
        question="Which chat app?"
        placeholder="Zulip, Threema, a chat app at work…"
        examples={EXAMPLES}
        action="Connect it with Conch"
        note="Conch reads its bot docs and makes it. You paste the bot’s token into the card, and say hello."
        onMake={(name) => startChat(`Connect me on ${name}`)}
      />
      <div>
        <Button
          variant="surface"
          size="sm"
          leadingIcon={<Link2 />}
          onClick={() => setFromLink(true)}
        >
          Add from a link
        </Button>
      </div>
      <CustomDialog open={fromLink} onOpenChange={setFromLink} tab="link" />
    </section>
  );
}
