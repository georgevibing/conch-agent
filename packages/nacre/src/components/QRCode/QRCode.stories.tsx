import type { Meta, StoryObj } from '@storybook/react-vite';

import { QRCode } from './QRCode';

const meta = {
  title: 'Components/Display/QRCode',
  component: QRCode,
  parameters: {
    docs: {
      description: {
        component:
          'A QR code for handing a link to a phone. Always dark on light with a quiet zone — that’s what cameras read best, in either theme.',
      },
    },
  },
  args: {
    value: 'https://studio-mac.tail1234.ts.net/#pair=Qm9vdHN0cmFwLXBhaXJpbmctY29kZS1leGFtcGxl',
    label: 'Scan with your phone to sign in',
    size: 200,
  },
} satisfies Meta<typeof QRCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
export const Small: Story = { args: { size: 120 } };
