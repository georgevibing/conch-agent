import { Button, CopyButton, Stack, Text } from '@conch/nacre';
import { SquareChevronRight } from 'lucide-react';

import { useUi } from '../../app/ui';
import { useTerminalStatus } from '../terminal/queries';
import styles from './AdminCommand.module.css';

/**
 * Something only an administrator can do here, in one press: Conch types the
 * command into its own terminal, and the person presses Enter and types their
 * own password there (Conch never sees it, and never runs it by itself). Then
 * Conch watches for what it brings (`watch`, a need) and says when it's done,
 * wherever the person is by then. Without a terminal here, the command to copy.
 */
export function AdminCommand({
  command,
  label = 'Open in terminal',
  what,
  watch,
  compact = false,
}: {
  command: string;
  /** The button: "Seal commands". */
  label?: string;
  /** What it changes, in a sentence. */
  what?: string;
  /** The need it brings, watched until it's here. */
  watch?: string;
  /** One row of buttons, for a list (Health). */
  compact?: boolean;
}) {
  const { data: terminal } = useTerminalStatus();
  const paste = useUi((s) => s.pasteInTerminal);
  const closeSettings = useUi((s) => s.closeSettings);
  const watchNeed = useUi((s) => s.watchNeed);
  const canType = Boolean(terminal?.available);
  const open = () => {
    // The terminal lives under the page: Settings steps aside so it's in view.
    closeSettings();
    paste(command);
    if (watch) watchNeed(watch);
  };
  // Copied to run somewhere else: Conch watches for it all the same.
  const copied = () => {
    if (watch) watchNeed(watch);
  };
  const buttons = (
    <Stack direction="row" gap={2} wrap align="center">
      {canType && (
        <Button
          size="sm"
          variant={compact ? 'surface' : 'solid'}
          leadingIcon={<SquareChevronRight />}
          onClick={open}
        >
          {label}
        </Button>
      )}
      <CopyButton
        value={command}
        label={canType ? 'Copy the command instead' : 'Copy command'}
        onCopied={copied}
      />
    </Stack>
  );
  if (compact) return buttons;
  return (
    <Stack gap={2}>
      {what && (
        <Text size="sm" tone="muted">
          {what}
        </Text>
      )}
      {canType ? (
        // The command itself opens it in the terminal, typed for you.
        <button
          type="button"
          className={styles.command}
          onClick={open}
          title="Type it into Conch’s terminal"
        >
          {command}
        </button>
      ) : (
        <code className={styles.command}>{command}</code>
      )}
      {buttons}
      <Text size="xs" tone="subtle">
        {canType
          ? 'It opens in Conch’s terminal, typed for you. Press Enter there and type your password; Conch notices when it’s done.'
          : 'Run it in a terminal on the computer Conch runs on. Conch notices when it’s done, no reload needed.'}
      </Text>
    </Stack>
  );
}
