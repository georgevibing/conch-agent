import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sources } from './Sources';
import { ViewSurface } from './fixtures';

const meta = {
  title: 'Patterns/Chat/Sources',
  component: Sources,
  render: ({ sources }) => <Sources sources={sources} />,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Web search and page references, with readable excerpts and explicit source links.',
      },
    },
  },
  args: {
    sources: [
      {
        title: 'Museum opening hours',
        url: 'https://www.smb.museum/en/',
        snippet:
          'Plan a visit to Berlin’s museums. Check the museum’s own page for today’s opening hours.',
      },
    ],
  },
  decorators: [
    (Story) => (
      <ViewSurface>
        <Story />
      </ViewSurface>
    ),
  ],
} satisfies Meta<typeof Sources>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Empty: Story = { args: { sources: [] } };
export const Many: Story = {
  args: {
    sources: Array.from({ length: 10 }, (_, i) => ({
      title: `Source ${i + 1}`,
      url: `https://example.org/${i}`,
      snippet: 'A short excerpt from the source.',
    })),
  },
};
export const Long: Story = {
  args: {
    sources: [
      {
        title:
          'A long source title with enough words to wrap across several lines on a narrow screen',
        url: 'https://example.org/report',
        snippet:
          'This source contains a detailed explanation of the result, its assumptions and the evidence behind it. Read the source before relying on an extract.',
      },
    ],
  },
};
