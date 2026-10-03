import type { Meta, StoryObj } from '@storybook/react-vite';

import { FileList } from './FileList';
import { AppTool, files, InChat, ViewSurface } from './fixtures';

const now = Date.now();

const meta = {
  title: 'Patterns/Chat/FileList',
  component: FileList,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Files a search found, under its tool row (ADR 0055): a glyph tinted by kind (documents blue, sheets green, slides amber, PDFs red, pictures in the accent, folders and the rest grey), the name, whose it is and when it changed. A row opens the file in a new tab.',
      },
    },
  },
  args: { files: files(now), now },
  decorators: [
    (Story) => (
      <ViewSurface>
        <Story />
      </ViewSurface>
    ),
  ],
} satisfies Meta<typeof FileList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Every kind, each with its own glyph and tint. */
export const Kinds: Story = {
  args: {
    files: [
      { name: 'Notes', mime: 'application/vnd.google-apps.document' },
      { name: 'Numbers', mime: 'application/vnd.google-apps.spreadsheet' },
      { name: 'Deck', mime: 'application/vnd.google-apps.presentation' },
      { name: 'Contract.pdf', mime: 'application/pdf' },
      { name: 'Photo.jpg', mime: 'image/jpeg' },
      { name: 'Archive', mime: 'application/vnd.google-apps.folder' },
      { name: 'data.bin', mime: 'application/octet-stream' },
    ],
  },
};

/** Many results fold after six. */
export const Many: Story = {
  args: {
    files: [...files(now), ...files(now)].map((f, i) => ({ ...f, name: `${f.name} ${i + 1}` })),
  },
};

/** Nothing matched. */
export const Empty: Story = { args: { files: [] } };

/** As it sits in a chat. */
export const InAConversation: Story = {
  decorators: [(Story) => <Story />],
  render: () => (
    <InChat
      ask="Find the launch deck in Drive"
      answer="It’s “Q4 launch deck”, which Ada changed three hours ago. The budget sheet and the plan are next to it."
    >
      <AppTool brand="google-drive" app="Google Drive" title="Find files" summary="launch">
        <FileList files={files(now)} now={now} />
      </AppTool>
    </InChat>
  ),
};
