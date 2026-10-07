import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Button } from '../../components/Button';
import { AvatarCropper, openPicture, type OpenedPicture } from './AvatarCropper';
import { AvatarPicker } from './AvatarPicker';

/** A soft portrait, so the photo states have something to show. */
const SAMPLE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#f4c7b8"/><stop offset="1" stop-color="#7f9cc9"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><circle cx="80" cy="64" r="28" fill="#fff" fill-opacity=".85"/><path d="M28 160c4-34 26-52 52-52s48 18 52 52z" fill="#fff" fill-opacity=".85"/></svg>',
)}`;

/** Everything sticks: choose a file (or drop one), frame it, remove it. */
function Live({ initial }: { initial?: string }) {
  const [photo, setPhoto] = useState(initial);
  return (
    <AvatarPicker
      name="George"
      src={photo}
      onSave={async (blob) => {
        await new Promise((done) => setTimeout(done, 500));
        setPhoto(URL.createObjectURL(blob));
      }}
      onRemove={() => setPhoto(undefined)}
    />
  );
}

const meta = {
  title: 'Patterns/Chat/AvatarPicker',
  component: AvatarPicker,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'Your photo, changed the way a phone does it. Your initial is a button with a small camera on it; coming near it, the camera covers the face. Press it, or drop a picture on it, and the picture opens in a frame.',
          'In the frame, drag the photo to move it and zoom with the slider, the buttons, a scroll or a pinch (from the keyboard, two quiet sliders inside the frame move it, and the stage shows their focus). The circle is what shows; the corners dim away. **Use this photo** hands back a 512px square, and it lands with a little spring and a pearl ring.',
          'Once there is a photo, the same press offers **Choose a new photo** or **Remove photo**.',
        ].join('\n\n'),
      },
    },
  },
  args: { name: 'George', onSave: () => {}, onRemove: () => {} },
} satisfies Meta<typeof AvatarPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: () => <Live /> };

export const WithPhoto: Story = {
  name: 'With a photo',
  render: () => <Live initial={SAMPLE} />,
};

/**
 * `AvatarCropper` on its own, for an agent's face: the same frame with a
 * rounded tile marked out, and what's kept shrunk until it fits `maxBytes`.
 */
export const TileCropper: Story = {
  name: 'Framing an agent’s face',
  render: function Render() {
    const [picture, setPicture] = useState<OpenedPicture>();
    const open = () =>
      void fetch(SAMPLE)
        .then((r) => r.blob())
        .then((blob) => openPicture(new Blob([blob], { type: 'image/svg+xml' })))
        .then(setPicture);
    useEffect(open, []);
    return (
      <>
        <Button variant="surface" onClick={open}>
          Frame a picture
        </Button>
        <AvatarCropper
          picture={picture}
          shape="tile"
          title="Frame the picture"
          description="Drag it to move it, and zoom until the face fills the tile."
          confirmLabel="Use this picture"
          maxBytes={700_000}
          onSave={() => setPicture(undefined)}
          onClose={() => setPicture(undefined)}
        />
      </>
    );
  },
};
