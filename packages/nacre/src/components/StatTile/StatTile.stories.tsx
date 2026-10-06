import type { Meta, StoryObj } from '@storybook/react-vite';
import { BatteryFull, Cpu, HardDrive, MemoryStick } from 'lucide-react';

import { walk } from '../LiveChart/LiveChart.stories';
import { StatTile } from './StatTile';

const meta = {
  title: 'Components/Data/StatTile',
  component: StatTile,
  args: {
    label: 'Processor',
    value: '18%',
    detail: '12 cores',
    icon: <Cpu />,
    trend: { values: walk(7, 18, 14), max: 100 },
  },
  decorators: [(Story) => <div style={{ inlineSize: 200 }}>{Story()}</div>],
  parameters: {
    docs: {
      description: {
        component:
          'One number at a glance: a label, the value large in the sans, a quiet detail, and a sparkline of the last few minutes or a meter. The digits turn like an odometer as the value changes; the value is read once as text.',
      },
    },
  },
} satisfies Meta<typeof StatTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Meter: Story = {
  args: {
    label: 'Disk',
    value: '28%',
    detail: '354 GB free',
    icon: <HardDrive />,
    trend: undefined,
    meter: 28,
  },
};

export const Tones: Story = {
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 200px)', gap: 12 }}>
        {Story()}
      </div>
    ),
  ],
  render: () => (
    <>
      <StatTile
        label="Memory"
        value="56%"
        detail="20 of 36 GB"
        icon={<MemoryStick />}
        trend={{ values: walk(9, 56, 3), max: 100, color: 'var(--nc-chart-3)' }}
      />
      <StatTile
        label="Disk"
        value="91%"
        detail="Running low · 42 GB free"
        icon={<HardDrive />}
        meter={91}
        tone="warning"
      />
      <StatTile
        label="Battery"
        value="6%"
        detail="On battery · plug in soon"
        icon={<BatteryFull />}
        meter={6}
        tone="critical"
      />
    </>
  ),
};
