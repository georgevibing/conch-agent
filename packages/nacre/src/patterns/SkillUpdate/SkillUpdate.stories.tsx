import type { Meta, StoryObj } from '@storybook/react-vite';
import { SkillUpdate } from './SkillUpdate';

const meta = {
  title: 'Patterns/Chat/SkillUpdate',
  component: SkillUpdate,
  args: {
    title: 'Development previews',
    summary: 'Use the standalone devapps CLI for previews.',
    before: 'Use clawapp to start development previews.',
    instructions:
      'Use devapps to start development previews. Bind the app to loopback and check its health before sharing a link.',
    onUpdate: () => undefined,
    onDismiss: () => undefined,
  },
  parameters: {
    docs: {
      description: {
        component: 'Review a proposed change to a saved skill, then apply it with one press.',
      },
    },
  },
} satisfies Meta<typeof SkillUpdate>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Saving: Story = { args: { state: 'saving' } };
export const Saved: Story = { args: { state: 'saved' } };
export const ChangedElsewhere: Story = { args: { state: 'stale' } };
export const Unavailable: Story = { args: { state: 'unavailable' } };
export const Failed: Story = { args: { error: 'Couldn’t save the update. Try again.' } };
export const WithWarning: Story = {
  args: { warnings: ['Downloads a program and makes it runnable.'] },
};
