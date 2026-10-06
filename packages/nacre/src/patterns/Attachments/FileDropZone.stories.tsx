import type { Meta, StoryObj } from '@storybook/react-vite';
import type React from 'react';
import { useState } from 'react';

import { Field } from '../../components/Field';
import { PasswordInput } from '../../components/PasswordInput';
import { FileDropZone, type FileDropState } from './FileDropZone';

const meta = {
  title: 'Patterns/Attachments/FileDropZone',
  component: FileDropZone,
  parameters: {
    docs: {
      description: {
        component:
          'One file a person downloaded somewhere else (a credential, a key): drop it anywhere on the area, choose it with the one button, or paste what’s in it. The area lights up while a file is over it. What landed is said in words beside an icon, and announced — never by colour alone.',
      },
    },
  },
  args: {
    title: 'Drop the file Google gave you',
    hint: 'It’s a small .json file, usually in Downloads, named client_secret_….json.',
    accept: '.json,application/json',
    onFile: () => undefined,
  },
} satisfies Meta<typeof FileDropZone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A file that arrived and checked out. */
export const Ready: Story = {
  args: {
    state: 'ok',
    fileName: 'client_secret_1234-abcd.apps.googleusercontent.com.json',
    message: 'Desktop app · my-conch-project. Ready to connect.',
    onClear: () => undefined,
  },
};

/** The wrong kind of file: what it is, and what to choose instead. */
export const Wrong: Story = {
  args: {
    state: 'error',
    fileName: 'service-account.json',
    message: 'This is a service-account key. Create a Desktop app OAuth client instead.',
  },
};

/** The whole round trip: drop or choose a file, or paste it. */
function Round(args: React.ComponentProps<typeof FileDropZone>) {
  const [state, setState] = useState<FileDropState>('idle');
  const [name, setName] = useState<string>();
  const [message, setMessage] = useState<string>();
  const take = (text: string, fileName?: string) => {
    setName(fileName);
    try {
      JSON.parse(text);
      setState('ok');
      setMessage('Looks right. Ready to connect.');
    } catch {
      setState('error');
      setMessage('That isn’t a JSON file. Download it from Google again.');
    }
  };
  return (
    <div style={{ maxInlineSize: '32rem' }}>
      <FileDropZone
        {...args}
        state={state}
        fileName={name}
        message={message}
        onClear={() => {
          setState('idle');
          setName(undefined);
          setMessage(undefined);
        }}
        onFile={(file) => {
          setState('checking');
          void file.text().then((text) => take(text, file.name));
        }}
        paste={{
          label: 'Paste its contents instead',
          content: (
            <Field>
              <Field.Label>What’s in the file</Field.Label>
              <PasswordInput autoComplete="off" onChange={(e) => take(e.currentTarget.value)} />
            </Field>
          ),
        }}
      />
    </div>
  );
}

export const Interactive: Story = { render: (args) => <Round {...args} /> };
