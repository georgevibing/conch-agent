import { Badge, Heading, IntegrationLogo, LinkCard, type BadgeTone } from '@conch/nacre';
import reference from 'virtual:conch-reference';

import type { IntegrationRef } from '../../reference/types';
import styles from './embeds.module.css';

const CATEGORIES: Record<string, string> = {
  productivity: 'Work and notes',
  developer: 'Building things',
  files: 'Files',
  passwords: 'Passwords',
  design: 'Design and websites',
  business: 'Customers and money',
  home: 'Home',
  browser: 'The web',
  other: 'More',
};

const AUTH: Record<IntegrationRef['auth'], { label: string; tone: BadgeTone }> = {
  google: { label: 'Google sign-in · setup required', tone: 'accent' },
  oauth: { label: 'One-click sign-in', tone: 'accent' },
  token: { label: 'Paste a token', tone: 'neutral' },
  none: { label: 'Nothing to sign in to', tone: 'neutral' },
  slack: { label: 'Your own Slack app · one key', tone: 'accent' },
};

/** Every app in Conch's gallery, by kind, with how each one signs in. */
export function AppsGallery() {
  const kinds = [...new Set(reference.integrations.map((app) => app.category))];
  return (
    <div className={styles.stack}>
      {kinds.map((kind) => (
        <section key={kind} className={styles.group} aria-label={CATEGORIES[kind] ?? kind}>
          <Heading level={3} size="md" tone="muted">
            {CATEGORIES[kind] ?? kind}
          </Heading>
          <div className={styles.grid}>
            {reference.integrations
              .filter((app) => app.category === kind)
              .map((app, index) => (
                <LinkCard
                  key={app.id}
                  index={index}
                  href={app.homepage}
                  target="_blank"
                  rel="noreferrer"
                  external
                  icon={
                    <IntegrationLogo brand={app.id} name={app.name} color={app.color} decorative />
                  }
                  title={app.name}
                  description={
                    <>
                      {app.description}
                      <span className={styles.cardFoot}>
                        <Badge size="sm" tone={AUTH[app.auth].tone}>
                          {AUTH[app.auth].label}
                        </Badge>
                        {app.local && (
                          <Badge size="sm" tone="neutral">
                            Runs on this computer
                          </Badge>
                        )}
                      </span>
                    </>
                  }
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
