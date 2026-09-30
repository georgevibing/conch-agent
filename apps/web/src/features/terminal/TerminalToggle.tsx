import { Button, IconButton } from '@conch/nacre';
import { SquareChevronRight, SquareTerminal } from 'lucide-react';

import { useUi } from '../../app/ui';
import { useTerminalStatus } from './queries';

/** The header's terminal button: shows and hides the drawer (⌘`). Gone while it's turned off. */
export function TerminalToggle() {
  const open = useUi((s) => s.terminalOpen);
  const toggle = useUi((s) => s.toggleTerminal);
  const { data: status } = useTerminalStatus();
  if (status?.settings.enabled === false && !open) return null;
  return (
    <IconButton
      label={open ? 'Hide the terminal' : 'Show the terminal'}
      shortcut="mod+`"
      aria-pressed={open}
      onClick={toggle}
    >
      <SquareTerminal />
    </IconButton>
  );
}

const SHELL_LANGUAGES = /^(sh|shell|bash|zsh|fish|console|terminal|powershell|pwsh|ps1?|cmd|bat)$/i;

/** Whether a code block holds commands someone would run. */
export function isShellCode(language: string | undefined): boolean {
  return Boolean(language && SHELL_LANGUAGES.test(language));
}

/**
 * "Run in terminal" on a shell code block: types the command into your
 * terminal and waits for your Enter. It never runs anything by itself.
 */
export function RunInTerminal({ code }: { code: string }) {
  const paste = useUi((s) => s.pasteInTerminal);
  // Prompts people copy along ("$ npm test", "PS> dir") aren't part of the command.
  const command = code
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\$|>|PS [^>]*>)\s+/, ''))
    .join('\n')
    .trimEnd();
  return (
    <Button
      size="sm"
      variant="ghost"
      leadingIcon={<SquareChevronRight />}
      onClick={() => paste(command)}
      title="Types it into your terminal. Press Enter there to run it."
    >
      Run in terminal
    </Button>
  );
}
