import type { Meta, StoryObj } from '@storybook/react-vite';

import { DnsRecordCard } from './DnsRecordCard';

const meta = {
  title: 'Patterns/Security/DnsRecordCard',
  component: DnsRecordCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The record to add at a domain provider so an address reaches Conch (ADR 0064): type, name and value, each ready to copy, and this server’s address said once. Conch keeps looking by itself; when the record arrives, one quiet check takes the card’s place.',
      },
    },
  },
  args: {
    name: 'conch.example.com',
    server: '203.0.113.7',
    state: 'waiting',
    records: [{ type: 'A', host: 'conch', value: '203.0.113.7' }],
  },
  argTypes: { state: { control: 'inline-radio', options: ['waiting', 'found'] } },
  decorators: [(Story) => <div style={{ maxInlineSize: 520 }}>{Story()}</div>],
} satisfies Meta<typeof DnsRecordCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Waiting: Story = {};

/** A server with IPv6 too: two records. */
export const TwoRecords: Story = {
  args: {
    records: [
      { type: 'A', host: 'conch', value: '203.0.113.7' },
      { type: 'AAAA', host: 'conch', value: '2001:db8::7' },
    ],
  },
};

/** The bare domain: `@`. */
export const BareDomain: Story = {
  args: { name: 'example.com', records: [{ type: 'A', host: '@', value: '203.0.113.7' }] },
};

export const Found: Story = { args: { state: 'found' } };
