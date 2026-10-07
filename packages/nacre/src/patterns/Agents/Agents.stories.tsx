import type { Meta, StoryObj } from '@storybook/react-vite';
import { ImageUp, Plus, Settings2, WandSparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Stack } from '../../components/Stack';
import type { AgentFace } from '../AgentAvatar/presets';
import { WelcomeVoice } from '../Welcome';
import { AgentAvatar } from '../AgentAvatar/AgentAvatar';
import { AgentCard } from './AgentCard';
import { AgentFacePicker } from './AgentFacePicker';
import { AgentGallery, type AgentGalleryItem } from './AgentGallery';
import { AgentPicker } from './AgentPicker';
import { ToneChips } from './ToneChips';

const cast: AgentGalleryItem[] = [
  { id: 'ag_conch', name: 'Conch', avatar: { kind: 'preset', id: 'shell' }, isDefault: true },
  {
    id: 'ag_atlas',
    name: 'Atlas',
    role: 'Plans trips and keeps the bookings',
    avatar: { kind: 'preset', id: 'compass' },
  },
  {
    id: 'ag_juniper',
    name: 'Juniper',
    role: 'Writes with me, kindly but honestly',
    avatar: { kind: 'preset', id: 'feather', color: 'violet' },
  },
  { id: 'ag_bolt', name: 'Bolt', role: 'Code reviews', avatar: { kind: 'preset', id: 'bot' } },
  { id: 'ag_hoot', name: 'Hoot', role: 'Research, with sources', avatar: 'owl' },
];

const tones = [
  { value: 'warm', label: 'Warm', description: 'Friendly and encouraging' },
  { value: 'concise', label: 'Concise', description: 'Brief and to the point' },
  { value: 'playful', label: 'Playful', description: 'Curious, with a sense of humour' },
  { value: 'precise', label: 'Precise', description: 'Careful and exact' },
  { value: 'calm', label: 'Calm', description: 'Patient and reassuring' },
  { value: 'formal', label: 'Formal', description: 'Polished and professional' },
  { value: 'candid', label: 'Candid', description: 'Honest, and says when you’re wrong' },
];

const meta = {
  title: 'Patterns/Agents/Agents',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Making and keeping agents (ADR 0101), the way profiles work on a television: a wall of faces, each one somebody.',
          '`AgentGallery` is the wall: press a face to open it, the + to make another, drag a face to move it (hold it first on a phone; Alt and an arrow from the keyboard), and its ⋯ for the rest. `AgentCard` is one profile; making one, its name follows what you type. `AgentFacePicker` chooses a face and its colour; `ToneChips` how it sounds. `AgentPicker` says who you’re talking to and switches.',
        ].join('\n\n'),
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The wall: open, make, move (drag, hold on a phone, or Alt+arrows), make default, delete. */
export const Gallery: Story = {
  render: function Render() {
    const [agents, setAgents] = useState(cast);
    const [arrived, setArrived] = useState<string>();
    return (
      <div style={{ maxInlineSize: 720 }}>
        <AgentGallery
          agents={agents}
          arrived={arrived}
          onOpen={() => {}}
          onReorder={(ids) =>
            setAgents((all) => ids.flatMap((id) => all.find((a) => a.id === id) ?? []))
          }
          onMakeDefault={(id) =>
            setAgents((all) => all.map((a) => ({ ...a, isDefault: a.id === id })))
          }
          onDelete={(id) => setAgents((all) => all.filter((a) => a.id !== id))}
          onCreate={() => {
            const id = `ag_new${agents.length}`;
            setAgents((all) => [
              ...all,
              { id, name: 'Sunny', avatar: { kind: 'preset', id: 'sun' } },
            ]);
            setArrived(id);
          }}
        />
      </div>
    );
  },
};

/** Only one: nothing to move or delete, and the + to make a second. */
export const GalleryOfOne: Story = {
  name: 'Gallery of one',
  render: () => <AgentGallery agents={cast.slice(0, 1)} onOpen={() => {}} onCreate={() => {}} />,
};

/** Making one: its name follows what's typed, its face lands when it changes, and it says hello. */
export const Making: Story = {
  render: function Render() {
    const [name, setName] = useState('Atlas');
    const [face, setFace] = useState<AgentFace>({ kind: 'preset', id: 'compass' });
    const [tone, setTone] = useState('warm');
    return (
      <Stack gap={5} align="center" style={{ maxInlineSize: 520, margin: '0 auto' }}>
        <AgentCard name={name} avatar={face} size="3xl" about="Plans trips" />
        <Input
          aria-label="Name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <AgentFacePicker name={name} value={face} onValueChange={setFace} />
        <ToneChips
          aria-label="How it sounds"
          choices={tones}
          value={tone}
          onValueChange={setTone}
        />
        <WelcomeVoice
          from={name || 'Your agent'}
          face={<AgentAvatar name={name} avatar={face} size="xs" decorative />}
          text={`Hi, I’m ${name || 'your agent'}. Where are we off to?`}
        />
      </Stack>
    );
  },
};

/** The faces, their colours, and the other ways to one: upload, or have one made. */
export const FacePicker: Story = {
  name: 'Face picker',
  render: function Render() {
    const [face, setFace] = useState<AgentFace>({ kind: 'preset', id: 'owl' });
    return (
      <div style={{ maxInlineSize: 460 }}>
        <AgentFacePicker
          name="Hoot"
          value={face}
          onValueChange={setFace}
          actions={
            <>
              <Button size="sm" variant="surface" leadingIcon={<ImageUp />}>
                Upload a picture
              </Button>
              <Button size="sm" variant="surface" leadingIcon={<WandSparkles />}>
                Create with AI
              </Button>
            </>
          }
        />
      </div>
    );
  },
};

/**
 * Where room is short (a dialog, the welcome): smaller faces, in two rows of
 * nine when they fit and three of six when they don't, centred on a centred page.
 */
export const FacePickerCompact: Story = {
  name: 'Face picker, compact and centred',
  render: function Render() {
    const [face, setFace] = useState<AgentFace>({ kind: 'preset', id: 'fox' });
    return (
      <Stack gap={8} align="center">
        <div style={{ inlineSize: 520 }}>
          <AgentFacePicker
            name="Rusty"
            value={face}
            size="lg"
            align="center"
            onValueChange={setFace}
          />
        </div>
        <div style={{ inlineSize: 320 }}>
          <AgentFacePicker
            name="Rusty"
            value={face}
            size="lg"
            align="center"
            onValueChange={setFace}
          />
        </div>
      </Stack>
    );
  },
};

/** A picture of its own leads the faces; the colours wait until a preset is chosen. */
export const FacePickerWithPicture: Story = {
  name: 'Face picker, with a picture',
  render: function Render() {
    const [face, setFace] = useState<AgentFace>({
      kind: 'image',
      url: `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#7f9cc9"/><circle cx="32" cy="26" r="12" fill="#fff"/><path d="M10 64c2-16 12-24 22-24s20 8 22 24z" fill="#fff"/></svg>',
      )}`,
    });
    return (
      <div style={{ maxInlineSize: 460 }}>
        <AgentFacePicker name="Ada" value={face} onValueChange={setFace} />
      </div>
    );
  },
};

export const Tones: Story = {
  render: function Render() {
    const [tone, setTone] = useState('candid');
    return (
      <ToneChips aria-label="How it sounds" choices={tones} value={tone} onValueChange={setTone} />
    );
  },
};

/** Who you're talking to: large where a new chat starts, a chip in a header. */
export const Picker: Story = {
  render: function Render() {
    const [id, setId] = useState('ag_atlas');
    const actions = [
      { label: 'New agent', icon: <Plus />, onSelect: () => {} },
      { label: 'Manage agents', icon: <Settings2 />, onSelect: () => {} },
    ];
    return (
      <Stack gap={8} align="center">
        <AgentPicker
          variant="hello"
          agents={cast}
          value={id}
          onValueChange={setId}
          actions={actions}
        />
        <AgentPicker
          variant="chip"
          label={(name) => `${name} answers this chat. Choose another`}
          heading="Switch to"
          agents={cast}
          value={id}
          onValueChange={setId}
        />
      </Stack>
    );
  },
};
