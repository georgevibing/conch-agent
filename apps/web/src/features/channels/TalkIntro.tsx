import { Handset } from '@conch/nacre';

import styles from './Channels.module.css';
import { APPS } from './describe';

/**
 * How talking to your assistant from a chat app works, for someone who has
 * none yet: three steps, and beside them a conversation as it would look.
 * Shown on Apps under "Talk to me here" (ADR 0052).
 */
export function TalkIntro({ assistant }: { assistant: string }) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageIntro}>
        <ol className={styles.how} aria-label="How it works">
          <li>Pick an app below.</li>
          <li>
            Make a bot of your own there, or link your own WhatsApp or Signal by scanning a code.
            Conch shows you every click and checks each step.
          </li>
          <li>
            Say hello from your phone. From then on, it’s yours: nobody else gets in unless you let
            them.
          </li>
        </ol>
      </div>
      <Handset
        label="An example conversation in Telegram"
        brand="telegram"
        color={APPS.telegram.color}
        title={assistant}
        subtitle="bot"
        messages={[
          { id: '1', from: 'you', text: 'Did the build pass? And what’s on my calendar tomorrow?' },
          {
            id: '2',
            from: 'them',
            text: 'The build passed ✅. Tomorrow: stand-up at 9:30 and lunch with Grace at 1.',
          },
          { id: '3', from: 'you', text: 'Great. Move lunch to 1:30 and tell her.' },
          {
            id: '4',
            from: 'them',
            text: (
              <p>
                🔐 <b>{assistant} would like to:</b> send an email to Grace
              </p>
            ),
            buttons: [
              { label: 'Allow', tone: 'primary' },
              { label: 'Don’t', tone: 'danger' },
            ],
          },
        ]}
        footer={<Handset.Composer />}
      />
    </div>
  );
}
