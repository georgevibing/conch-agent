import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SkillProblem, type DescriptionDraft } from './SkillProblem';

const soon = <T,>(value: T, ms = 700) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const describe = (draft: DescriptionDraft) =>
  ({
    kind: 'describe',
    onDraft: () => soon(draft),
    onSave: () => soon(undefined),
  }) as const;

const NO_DESCRIPTION = 'It has no description, so an assistant wouldn’t know when to use it.';

const meta = {
  title: 'Patterns/Skills/SkillProblem',
  component: SkillProblem,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A skill that can’t be used, with the one thing that fixes it. When it only lacks a description, Conch writes one from the skill’s own words — a quick look, editable, then one Save; with no model connected it says so and starts from the first sentence, or an empty box. Another app’s skill says where it lives and offers a copy you can edit, because Conch never writes in other apps’ folders. A file Conch couldn’t read gets “Look again”.',
      },
    },
  },
  args: {
    problem: NO_DESCRIPTION,
    fix: describe({
      description: 'Sorts the Downloads folder by type. Use when asked to clean up downloads.',
      from: 'model',
      noModel: false,
    }),
  },
  decorators: [(Story) => <div style={{ maxInlineSize: '40rem' }}>{Story()}</div>],
} satisfies Meta<typeof SkillProblem>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Yours, missing its description: one button writes it. */
export const NeedsADescription: Story = {};

const openDraft: Story['play'] = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Write the description for me' }));
  await expect(
    await canvas.findByRole('textbox', { name: 'Description' }, { timeout: 3000 }),
  ).toHaveFocus();
};

/** The draft, for a quick look: edit it or save it as it is. */
export const Written: Story = { play: openDraft };

/** No provider connected: it says so, and starts from the first sentence. */
export const NoModelConnected: Story = {
  args: {
    fix: describe({
      description: 'Turn a meeting transcript into action items.',
      from: 'text',
      noModel: true,
    }),
  },
  play: openDraft,
};

/** Nothing to write it from: an empty box to type in. */
export const NothingToGoOn: Story = {
  args: { fix: describe({ description: '', from: 'none', noModel: false }) },
  play: openDraft,
};

/** Another app's skill: where it lives, and a copy you can edit. */
export const FromAnotherApp: Story = {
  args: {
    problem: 'Its SKILL.md has no front matter (the --- block with a name and description).',
    fix: { kind: 'copy', owner: 'Claude Code', onCopy: () => soon(undefined) },
  },
};

/** Conch couldn't read the file: check it, then look again. */
export const CouldNotRead: Story = {
  args: {
    problem: 'SKILL.md is too big to read.',
    fix: { kind: 'check', onCheck: () => soon(undefined) },
  },
};
