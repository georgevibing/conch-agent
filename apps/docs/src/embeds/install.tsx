import { CommandLine, OsMark, Tabs } from '@conch/nacre';
import { useState } from 'react';

import { INSTALL } from '../site/config';
import styles from './embeds.module.css';

/** Windows, or everything else: decided from the browser, changed with one press. */
export function likelySystem(): 'unix' | 'windows' {
  return typeof navigator !== 'undefined' && /Win/i.test(navigator.platform) ? 'windows' : 'unix';
}

/** The one line that installs Conch, for the computer you're reading this on. */
export function InstallCommand({ typed = false }: { typed?: boolean; args?: string[] }) {
  const [system, setSystem] = useState(likelySystem);
  return (
    <Tabs
      variant="pill"
      size="sm"
      value={system}
      onValueChange={(value) => setSystem(value === 'windows' ? 'windows' : 'unix')}
      className={styles.install}
    >
      <Tabs.List aria-label="Your computer">
        <Tabs.Trigger value="unix">
          <span className={styles.system}>
            <OsMark os="macos" />
            macOS
          </span>{' '}
          and{' '}
          <span className={styles.system}>
            <OsMark os="linux" />
            Linux
          </span>
        </Tabs.Trigger>
        <Tabs.Trigger value="windows">
          <span className={styles.system}>
            <OsMark os="windows" />
            Windows
          </span>
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="unix">
        <CommandLine size="lg" typed={typed} command={INSTALL.unix} />
      </Tabs.Content>
      <Tabs.Content value="windows">
        <CommandLine size="lg" typed={typed} prompt=">" command={INSTALL.windows} />
      </Tabs.Content>
    </Tabs>
  );
}

/** The line for a server: Linux, over SSH, then a few questions (ADR 0064). */
export function ServerInstallCommand() {
  return <CommandLine size="lg" command={INSTALL.server} />;
}
