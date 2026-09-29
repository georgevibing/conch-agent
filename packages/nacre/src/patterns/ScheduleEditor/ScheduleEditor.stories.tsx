import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import type { SchedulePreviewValue, ScheduleValue } from '../Routines/types';
import { fakePreview } from './fixtures';
import { ScheduleEditor } from './ScheduleEditor';

const meta = {
  title: 'Patterns/Routines/ScheduleEditor',
  component: ScheduleEditor,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '“When should it run?” — everyday choices are plain controls; Custom takes a cron expression. The preview always says in words exactly what will happen, shows the next runs, and warns when a schedule would run very often.',
      },
    },
  },
  args: {
    value: { type: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30' },
    onChange: () => {},
    timezone: 'Europe/Berlin',
  },
} satisfies Meta<typeof ScheduleEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

function Interactive({ initial }: { initial: ScheduleValue }) {
  const [value, setValue] = useState(initial);
  // Simulate the round trip to the gateway: the preview catches up shortly after each change.
  const [preview, setPreview] = useState<{ for: ScheduleValue; value: SchedulePreviewValue }>();
  useEffect(() => {
    const t = setTimeout(() => setPreview({ for: value, value: fakePreview(value) }), 160);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div style={{ maxInlineSize: '32rem' }}>
      <ScheduleEditor
        value={value}
        onChange={setValue}
        timezone="Europe/Berlin"
        preview={preview?.value}
        loading={preview?.for !== value}
      />
    </div>
  );
}

export const Weekdays: Story = {
  render: () => (
    <Interactive
      initial={{ type: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30' }}
    />
  ),
};

export const Weekly: Story = {
  render: () => <Interactive initial={{ type: 'weekly', days: ['sun'], time: '18:00' }} />,
};

export const Monthly: Story = {
  render: () => <Interactive initial={{ type: 'monthly', day: 31, time: '09:00' }} />,
};

export const EveryFewHours: Story = {
  render: () => <Interactive initial={{ type: 'interval', every: 2, unit: 'hours' }} />,
};

export const Once: Story = {
  render: () => (
    <Interactive
      initial={{ type: 'once', at: new Date(Date.now() + 26 * 3_600_000).toISOString() }}
    />
  ),
};

export const VeryOften: Story = {
  name: 'Warns when very frequent',
  render: () => <Interactive initial={{ type: 'interval', every: 15, unit: 'minutes' }} />,
};

export const Custom: Story = {
  render: () => <Interactive initial={{ type: 'cron', expression: '0 9 * * 1-5' }} />,
};

export const InvalidCustom: Story = {
  render: () => <Interactive initial={{ type: 'cron', expression: '0 9 * *' }} />,
};

export const Loading: Story = {
  args: { loading: true, value: { type: 'daily', time: '08:00' } },
};
