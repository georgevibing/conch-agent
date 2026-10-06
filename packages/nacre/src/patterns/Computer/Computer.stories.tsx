import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bot, Globe, Shell, SquareTerminal } from 'lucide-react';

import { LiveChart } from '../../components/LiveChart';
import { walk } from '../../components/LiveChart/LiveChart.stories';
import { StatTile } from '../../components/StatTile';
import { Stack } from '../../components/Stack';
import { ComputerHeader, CoreStrip, HelperList } from './Computer';

const COUNT = 90;
const END = 1_791_300_000_000;
const times = Array.from({ length: COUNT }, (_, i) => END - (COUNT - 1 - i) * 2000);
const percent = (v: number) => `${Math.round(v)}%`;

const meta = {
  title: 'Patterns/Computer/ThisComputer',
  component: ComputerHeader,
  args: {
    os: 'macos',
    name: 'Apple M3 Pro',
    status: 'Room to spare',
    facts: ['macOS 26.7', '12 cores', '36 GB memory', 'Up 3 days'],
  },
  parameters: {
    docs: {
      description: {
        component:
          'Settings → This computer. How the computer is doing in a few words, the numbers that matter at a glance, the last few minutes as live charts, and what Conch started, by who it belongs to.',
      },
    },
  },
} satisfies Meta<typeof ComputerHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Header: Story = {};

export const Busy: Story = {
  args: { status: 'Busy right now', tone: 'busy', os: 'linux', name: 'AMD Ryzen 7 7840U' },
};

export const Cores: Story = {
  render: () => (
    <div style={{ inlineSize: 360 }}>
      <CoreStrip values={[62, 48, 30, 22, 18, 9, 4, 2, 41, 12, 7, 0]} />
    </div>
  ),
};

const helpers = [
  {
    id: 'conch',
    label: 'Conch',
    icon: <Shell />,
    detail: 'Up 2 hours',
    cpu: '0.4%',
    memory: '93 MB',
    trend: { values: walk(2, 0.5, 0.6), max: 10 },
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    icon: <Bot />,
    detail: '3 processes',
    cpu: '4.2%',
    memory: '412 MB',
    trend: { values: walk(4, 4, 5), max: 10 },
  },
  {
    id: 'browser',
    label: 'Browser',
    icon: <Globe />,
    detail: '6 processes',
    cpu: '2.1%',
    memory: '1.1 GB',
    trend: { values: walk(6, 2, 3), max: 10 },
  },
  {
    id: 'other',
    label: 'Commands and helpers',
    icon: <SquareTerminal />,
    detail: '2 processes',
    cpu: '0%',
    memory: '24 MB',
    trend: { values: walk(8, 0.2, 0.3), max: 10 },
  },
];

export const WhatsRunning: Story = {
  render: () => (
    <div style={{ inlineSize: 'min(100%, 640px)' }}>
      <HelperList rows={helpers} caption="Conch and what it started" />
    </div>
  ),
};

/** The whole page, composed. */
export const ThisComputer: Story = {
  render: (args) => (
    <Stack gap={8} style={{ inlineSize: 'min(100%, 760px)' }}>
      <ComputerHeader {...args} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        <StatTile
          label="Processor"
          value="18%"
          detail="Load 2.4"
          trend={{ values: walk(7, 18, 14), max: 100 }}
        />
        <StatTile
          label="Memory"
          value="56%"
          detail="20 of 36 GB"
          trend={{ values: walk(9, 56, 3), max: 100, color: 'var(--nc-chart-3)' }}
        />
        <StatTile label="Disk" value="28%" detail="354 GB free" meter={28} />
        <StatTile label="Battery" value="100%" detail="Charged" meter={100} />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 32,
        }}
      >
        <Stack gap={3}>
          <LiveChart
            title="Processor"
            detail="Load 2.4"
            times={times}
            max={100}
            format={percent}
            series={[{ id: 'cpu', label: 'Processor', values: walk(7, 18, 14) }]}
          />
          <CoreStrip values={[62, 48, 30, 22, 18, 9, 4, 2, 41, 12, 7, 0]} />
        </Stack>
        <LiveChart
          title="Memory"
          detail="20 of 36 GB"
          times={times}
          max={100}
          format={percent}
          series={[
            { id: 'mem', label: 'Memory', values: walk(9, 56, 3), color: 'var(--nc-chart-3)' },
          ]}
        />
      </div>
      <HelperList rows={helpers} caption="Conch and what it started" />
    </Stack>
  ),
};
