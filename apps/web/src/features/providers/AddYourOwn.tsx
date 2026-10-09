import { Button, Heading, MakeWithConch } from '@conch/nacre';
import { Link2, Server } from 'lucide-react';
import { useId, useState } from 'react';

import { useUi } from '../../app/ui';
import { useStartChat } from '../conchapps/useStartChat';
import { CustomDialog } from '../integrations/CustomDialog';
import styles from './Providers.module.css';

/** Names people ask for that Conch doesn't ship, as the chips. */
const EXAMPLES = ['Fireworks AI', 'Baseten', 'Perplexity', 'SambaNova'];

/**
 * **Add your own** (ADR 0122): any provider, three ways. **Make one with
 * Conch** from its name — Conch reads its docs, makes it, tests it with your
 * key and shows a card. **Any OpenAI-compatible address** for a server you
 * know the address of. **From a link** for one someone shared. No hub.
 */
export function AddYourOwn({ onAddServer }: { onAddServer: () => void }) {
  const headingId = useId();
  const startChat = useStartChat();
  const closeSettings = useUi((s) => s.closeSettings);
  const [fromLink, setFromLink] = useState(false);
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <Heading level={3} size="sm" tone="muted" id={headingId}>
        Add your own
      </Heading>
      <MakeWithConch
        question="Which provider?"
        placeholder="Fireworks, Baseten, a model at work…"
        examples={EXAMPLES}
        note="Conch reads its API docs, makes it, and tests it with your key. Nothing is added until you press Add."
        onMake={(name) => {
          closeSettings();
          startChat(`Add ${name} as a provider`);
        }}
      />
      <div className={styles.ownWays}>
        <Button variant="surface" size="sm" leadingIcon={<Server />} onClick={onAddServer}>
          Any OpenAI-compatible address
        </Button>
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
