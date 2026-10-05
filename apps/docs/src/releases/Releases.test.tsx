import { NacreProvider } from '@conch/nacre';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';

import type { PublishedRelease } from '../../publishing/schema';
import { ReleaseHistory } from './Releases';

const release = (channel: PublishedRelease['channel']): PublishedRelease => ({
  tag: channel === 'stable' ? 'v0.3.0' : `v0.4.0-${channel}.1`,
  version: channel === 'stable' ? '0.3.0' : `0.4.0-${channel}.1`,
  channel,
  name: `Conch ${channel}`,
  notes: `## New\n\nA ${channel} improvement.`,
  commit: 'a'.repeat(40),
  published: '2026-10-05T10:00:00Z',
  downloads: channel === 'stable',
});
const open = (releases: PublishedRelease[]) =>
  render(
    <NacreProvider>
      <ReleaseHistory releases={releases} />
    </NacreProvider>,
  );

describe('published release notes', () => {
  it('explains the development fallback before a release exists', async () => {
    const { container } = open([]);
    expect(screen.getByText('No releases yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /downloads/i })).not.toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });
  it('filters stable, beta and alpha notes with accessible tabs and exact source links', async () => {
    const { container } = open(
      ['stable', 'beta', 'alpha'].map((channel) => release(channel as PublishedRelease['channel'])),
    );
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);
    await userEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(screen.getByRole('heading', { name: 'Conch beta' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Conch stable' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source at v0.4.0-beta.1' })).toHaveAttribute(
      'href',
      `https://github.com/georgevibing/conch-agent/tree/${'a'.repeat(40)}`,
    );
    expect(screen.queryByRole('link', { name: /downloads/i })).not.toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });
  it('does not execute HTML, images or unsafe links in public notes', () => {
    const { container } = open([
      {
        ...release('stable'),
        notes:
          '<script>alert(1)</script>\n\n[bad](javascript:alert) ![outside](https://example.com/tracker.png)\n\n[Guide](docs/RELEASING.md)',
      },
    ]);
    expect(container.querySelector('script,img')).toBeNull();
    expect(screen.queryByRole('link', { name: 'bad' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Guide' })).toHaveAttribute(
      'href',
      'https://github.com/georgevibing/conch-agent/blob/v0.3.0/docs/RELEASING.md',
    );
  });
});
