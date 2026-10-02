import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../components/Button';
import { SkillPermissionList } from './SkillPermissionList';
import { SkillSignatureBadge } from './SkillSignatureBadge';
import { TrustedPublisherList } from './TrustedPublisherList';

const meta = {
  title: 'Patterns/Skills/SkillTrust',
  component: SkillPermissionList,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What a skill may do, and who made it (ADR 0031). A chat it’s used in is held to the list in every later turn too (ADR 0040): anything else the skill tries asks first, in every mode. A signature that holds from a publisher you trust says “Verified”; one that doesn’t hold turns the skill off.',
      },
    },
  },
  args: {
    declared: true,
    capabilities: ['commands', 'files'],
    words: ['run commands (only `git`)', 'change files in your work folder'],
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 640 }}>{Story()}</div>],
} satisfies Meta<typeof SkillPermissionList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Declared: Story = {};
export const Undeclared: Story = {
  args: {
    declared: false,
    capabilities: ['files', 'web'],
    words: ['change files in your work folder', 'read the web'],
  },
};
export const ReadOnly: Story = { args: { capabilities: [], words: [] } };
export const InADialog: Story = { args: { variant: 'compact' } };

export const Verified: Story = {
  render: () => (
    <SkillSignatureBadge
      state="verified"
      publisher="Ada Lovelace"
      fingerprint="3F9A 21C0 7B44 E1D2"
    />
  ),
};
export const Untrusted: Story = {
  render: () => (
    <SkillSignatureBadge
      state="untrusted"
      publisher="Ada Lovelace"
      fingerprint="3F9A 21C0 7B44 E1D2"
      action={<Button size="sm">Trust this publisher…</Button>}
    />
  ),
};
export const Lookalike: Story = {
  render: () => (
    <SkillSignatureBadge
      state="untrusted"
      lookalike
      publisher="Ada Lovelace"
      fingerprint="0B1D 77E2 9C04 5A6F"
    />
  ),
};
export const Invalid: Story = {
  render: () => (
    <SkillSignatureBadge
      state="invalid"
      publisher="Ada Lovelace"
      fingerprint="3F9A 21C0 7B44 E1D2"
      problem="It was changed after Ada Lovelace signed it."
    />
  ),
};
export const Unsigned: Story = { render: () => <SkillSignatureBadge state="unsigned" /> };

export const Publishers: Story = {
  render: () => (
    <TrustedPublisherList
      publishers={[
        {
          fingerprint: '42C6 0E2A 7D42 118C',
          name: 'You',
          trustedAt: 1_790_000_000_000,
          you: true,
        },
        { fingerprint: '3F9A 21C0 7B44 E1D2', name: 'Ada Lovelace', trustedAt: 1_790_500_000_000 },
      ]}
      onForget={() => undefined}
    />
  ),
};
export const NoPublishers: Story = {
  render: () => <TrustedPublisherList publishers={[]} />,
};
