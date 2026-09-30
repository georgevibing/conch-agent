import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import {
  TerminalKeys,
  TerminalNotice,
  TerminalPanel,
  withCtrl,
  type TerminalTab,
} from './TerminalPanel';
import { TerminalView, type TerminalViewHandle } from './TerminalView';

const ESC = '\x1b';
const PROMPT = `${ESC}[38;5;244m~/projects/conch${ESC}[0m ${ESC}[35m❯${ESC}[0m `;

/** What `ls --color` and a test run look like, in the theme's ANSI colours. */
const WELCOME = [
  `${ESC}]0;~/projects/conch${ESC}\\`,
  `${PROMPT}ls\r\n`,
  `${ESC}[34mapps${ESC}[0m  ${ESC}[34mdocs${ESC}[0m  ${ESC}[34mpackages${ESC}[0m  package.json  ${ESC}[32mpnpm-lock.yaml${ESC}[0m  README.md\r\n`,
  `${PROMPT}pnpm test\r\n`,
  `\r\n ${ESC}[1;36mRUN${ESC}[0m  v5.0.2 ${ESC}[90m~/projects/conch${ESC}[0m\r\n\r\n`,
  ` ${ESC}[32m✓${ESC}[0m src/browser/guard.test.ts ${ESC}[90m(7 tests) 12ms${ESC}[0m\r\n`,
  ` ${ESC}[32m✓${ESC}[0m src/terminal/session.test.ts ${ESC}[90m(6 tests) 48ms${ESC}[0m\r\n`,
  ` ${ESC}[31m✗${ESC}[0m src/routines/schedule.test.ts ${ESC}[90m> weekdays${ESC}[0m\r\n`,
  `   ${ESC}[31mAssertionError:${ESC}[0m expected ${ESC}[32m'07:30'${ESC}[0m to be ${ESC}[31m'7:30'${ESC}[0m\r\n\r\n`,
  ` ${ESC}[1mTests${ESC}[0m  ${ESC}[31m1 failed${ESC}[0m | ${ESC}[32m392 passed${ESC}[0m ${ESC}[33m(393)${ESC}[0m\r\n`,
  ...['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].map(
    (name, i) =>
      `${ESC}[3${i}m■ ${name.padEnd(8)}${ESC}[0m ${ESC}[9${i}m■ bright ${name}${ESC}[0m\r\n`,
  ),
  PROMPT,
].join('');

/** A pretend shell: echoes what you type and answers a couple of commands. */
function useDemoShell(view: React.RefObject<TerminalViewHandle | null>) {
  const line = useRef('');
  useEffect(() => {
    view.current?.write(WELCOME);
  }, [view]);
  return (data: string) => {
    const term = view.current;
    if (!term) return;
    for (const char of data) {
      if (char === '\r') {
        const cmd = line.current.trim();
        line.current = '';
        term.write('\r\n');
        if (cmd === 'ls')
          term.write(`${ESC}[34mapps${ESC}[0m  ${ESC}[34mdocs${ESC}[0m  README.md\r\n`);
        else if (cmd === 'clear') term.reset();
        else if (cmd)
          term.write(`${ESC}[90m(this is a pretend shell in Storybook: try ls)${ESC}[0m\r\n`);
        term.write(PROMPT);
      } else if (char === '\x7f') {
        if (line.current) {
          line.current = line.current.slice(0, -1);
          term.write('\b \b');
        }
      } else if (char >= ' ') {
        line.current += char;
        term.write(char);
      }
    }
  };
}

function Demo({ fontSize }: { fontSize?: number }) {
  const view = useRef<TerminalViewHandle>(null);
  const input = useDemoShell(view);
  return <TerminalView ref={view} label="Terminal: zsh" fontSize={fontSize} onInput={input} />;
}

const meta = {
  title: 'Patterns/Terminal/TerminalPanel',
  component: TerminalPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The terminal drawer: real shells on the machine Conch runs on, in Nacre’s own ANSI palette (tuned for both themes; light mode’s “white” stays legible). It surfaces from the bottom of whatever you’re doing; every shell keeps running while it’s closed. Tabs show a pearl when a shell you’re not looking at prints something. Ended shells offer Restart — and, when a broken profile killed them at start, Start without your profile. On touch screens a key row adds Esc, Tab, Ctrl and arrows.',
      },
    },
  },
  args: {
    tabs: [],
    onSelect: fn(),
    onClose: fn(),
    onNew: fn(),
    onHide: fn(),
    children: () => null,
  },
  decorators: [
    (Story) => (
      <div style={{ blockSize: 420, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, padding: 24, color: 'var(--nc-text-muted)' }}>The chat…</div>
        <div style={{ blockSize: 300 }}>
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof TerminalPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const tabs: TerminalTab[] = [
  { id: 'a', title: '~/projects/conch', status: 'running' },
  { id: 'b', title: 'pnpm dev', status: 'running', activity: true },
  { id: 'c', title: 'ssh studio', status: 'exited' },
];

const toolbar = (
  <>
    <Button size="sm" variant="ghost" leadingIcon={<Sparkles />}>
      Ask Conch
    </Button>
    <IconButton size="sm" variant="ghost" label="Find in terminal" shortcut="mod+f">
      <Search />
    </IconButton>
  </>
);

/** Type into it: a pretend shell answers, in the theme's colours. */
export const Playground: Story = {
  render: function Render(args) {
    const [active, setActive] = useState('a');
    return (
      <TerminalPanel {...args} tabs={tabs} active={active} onSelect={setActive} actions={toolbar}>
        {(id) => (id === 'a' ? <Demo /> : <TerminalView label={`Terminal ${id}`} />)}
      </TerminalPanel>
    );
  },
};

export const Ended: Story = {
  render: (args) => (
    <TerminalPanel {...args} tabs={[{ id: 'c', title: 'zsh', status: 'exited' }]} active="c">
      {() => (
        <>
          <TerminalView label="Terminal: zsh" />
          <TerminalNotice
            tone="ended"
            title="The shell stopped right away (code 1)"
            detail="That usually means something in your shell profile failed. You can start without it and fix it from there."
            actions={
              <>
                <Button size="sm" variant="ghost">
                  Close
                </Button>
                <Button size="sm" variant="surface">
                  Restart
                </Button>
                <Button size="sm">Start without your profile</Button>
              </>
            }
          />
        </>
      )}
    </TerminalPanel>
  ),
};

export const Connecting: Story = {
  render: (args) => (
    <TerminalPanel {...args} tabs={[{ id: 'a', title: 'zsh', status: 'connecting' }]} active="a">
      {() => <TerminalNotice busy title="Reconnecting…" detail="Your shell is still running." />}
    </TerminalPanel>
  ),
};

export const FromAnotherDevice: Story = {
  render: (args) => (
    <TerminalPanel {...args} tabs={[]}>
      {() => null}
    </TerminalPanel>
  ),
  args: {
    empty: (
      <TerminalNotice
        tone="problem"
        title="Terminals only open on the computer Conch runs on"
        detail="To use one here, turn on “From other devices” in Settings › Terminal. You’ll confirm it’s you each time."
        actions={<Button size="sm">Open settings</Button>}
      />
    ),
  },
};

export const NothingOpen: Story = {};

/** Phones and tablets get the keys they're missing. */
export const TouchKeys: Story = {
  render: function Render(args) {
    const [ctrl, setCtrl] = useState(false);
    const view = useRef<TerminalViewHandle>(null);
    const input = useDemoShell(view);
    return (
      <TerminalPanel
        {...args}
        tabs={[tabs[0] as TerminalTab]}
        active="a"
        keys={<TerminalKeys ctrl={ctrl} onCtrlChange={setCtrl} onKey={(seq) => input(seq)} />}
      >
        {() => (
          <TerminalView
            ref={view}
            label="Terminal: zsh"
            onInput={(data) => {
              input(ctrl ? withCtrl(data) : data);
              setCtrl(false);
            }}
          />
        )}
      </TerminalPanel>
    );
  },
};
