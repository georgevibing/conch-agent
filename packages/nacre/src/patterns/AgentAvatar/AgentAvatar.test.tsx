import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AgentAvatar, AgentAvatarArtProvider } from './AgentAvatar';
import { AgentChange } from './AgentChange';
import { AGENT_AVATAR_ART, agentAvatarLook } from './presets';

describe('agentAvatarLook', () => {
  it('reads the protocol’s face: a preset with its colour, or a picture', () => {
    expect(agentAvatarLook({ kind: 'preset', id: 'spark' })).toMatchObject({
      kind: 'preset',
      id: 'spark',
      color: 'yellow',
    });
    expect(agentAvatarLook({ kind: 'preset', id: 'spark', color: 'lime' })).toMatchObject({
      color: 'lime',
    });
    expect(agentAvatarLook({ kind: 'image', url: '/api/agents/ag_ada/avatar/im_1234' })).toEqual({
      kind: 'picture',
      src: '/api/agents/ag_ada/avatar/im_1234',
    });
  });

  it('reads a preset’s id or a picture’s address, for short', () => {
    expect(agentAvatarLook('owl')).toMatchObject({ kind: 'preset', id: 'owl' });
    for (const src of [
      'https://example.com/ada.png',
      '/api/agents/ada/avatar?v=3',
      'data:image/png;base64,AAAA',
      'blob:https://conch.local/1234',
    ])
      expect(agentAvatarLook(src)).toEqual({ kind: 'picture', src });
  });

  it('is Conch’s mark for the shell in its own colour; in another, its spiral on that colour', () => {
    expect(agentAvatarLook({ kind: 'preset', id: 'shell' })).toEqual({ kind: 'mark' });
    expect(agentAvatarLook({ kind: 'preset', id: 'shell', color: 'teal' })).toMatchObject({
      kind: 'preset',
      color: 'teal',
    });
  });

  it('falls back to Conch’s mark, never a blank', () => {
    for (const avatar of [
      undefined,
      '',
      '  ',
      'a-newer-preset',
      'constructor',
      '//elsewhere.example/x.png',
      { kind: 'image' as const, url: 'javascript:alert(1)' },
    ])
      expect(agentAvatarLook(avatar)).toEqual({ kind: 'mark' });
  });

  it('has a label and a colour for every preset', () => {
    for (const art of Object.values(AGENT_AVATAR_ART)) {
      expect(art.label).not.toBe('');
      expect(art.color).not.toBe('');
    }
  });

  it('draws every preset but the shell (Conch’s own mark) as one of the cast', () => {
    for (const [id, art] of Object.entries(AGENT_AVATAR_ART))
      expect(Boolean(art.figure), id).toBe(id !== 'shell');
  });
});

describe('AgentAvatar', () => {
  it('draws a preset with the web app’s own artwork when it has some', () => {
    const Owl = (props: object) => <svg data-testid="owl-art" {...props} />;
    renderNacre(
      <AgentAvatarArtProvider art={{ owl: { label: 'Owl', color: 'amber', glyph: Owl } }}>
        <AgentAvatar name="Hoot" avatar={{ kind: 'preset', id: 'owl' }} />
        <AgentAvatar name="Sunny" avatar={{ kind: 'preset', id: 'sun' }} />
      </AgentAvatarArtProvider>,
    );
    expect(screen.getByRole('img', { name: 'Hoot' })).toContainElement(
      screen.getByTestId('owl-art'),
    );
    // The rest keep Nacre's drawing.
    expect(screen.getByRole('img', { name: 'Sunny' })).toHaveAttribute('data-preset', 'sun');
  });

  it('wears Conch’s mark without an avatar, named for who it is', async () => {
    const { container } = renderNacre(<AgentAvatar name="Conch" />);
    const face = screen.getByRole('img', { name: 'Conch' });
    expect(face.querySelector('svg')).not.toBeNull();
    await expectAccessible(container);
  });

  it('draws a preset as its figure on its colour', async () => {
    const { container } = renderNacre(<AgentAvatar name="Scout" avatar="compass" size="lg" />);
    const face = screen.getByRole('img', { name: 'Scout' });
    expect(face).toHaveAttribute('data-look', 'preset');
    expect(face).toHaveAttribute('data-figure');
    expect(face.querySelector('svg[viewBox="0 0 64 64"]')).not.toBeNull();
    expect(face).toHaveAttribute('data-color', 'teal');
    expect(face).toHaveAttribute('data-size', 'lg');
    await expectAccessible(container);
  });

  it('shows the initial until a picture loads, and keeps it if the picture can’t', () => {
    const { container, rerender } = renderNacre(
      <AgentAvatar name="Ada" avatar="https://example.com/ada.png" />,
    );
    expect(screen.getByRole('img', { name: 'Ada' })).toHaveTextContent('A');
    const picture = container.querySelector('img') as HTMLImageElement;
    expect(picture).not.toHaveAttribute('data-shown');
    fireEvent.load(picture);
    expect(picture).toHaveAttribute('data-shown');

    rerender(<AgentAvatar name="Ada" avatar="https://example.com/gone.png" />);
    const broken = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(broken);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Ada' })).toHaveTextContent('A');
  });

  it('is left unread beside its name', () => {
    const { container } = renderNacre(<AgentAvatar name="Conch" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('[data-size]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('comes alive while working, for every look', () => {
    for (const avatar of [undefined, 'leaf', 'https://example.com/ada.png']) {
      const { container, unmount } = renderNacre(
        <AgentAvatar name="Ada" avatar={avatar} active since={Date.now() - 1_000} />,
      );
      const face = container.querySelector<HTMLElement>('[data-active]');
      expect(face).not.toBeNull();
      expect(
        Number.parseInt(face?.style.getPropertyValue('--nc-mark-age') ?? '', 10),
      ).toBeGreaterThanOrEqual(1_000);
      unmount();
    }
  });
});

describe('AgentChange', () => {
  it('says who took over from whom, in one line', async () => {
    const { container } = renderNacre(
      <AgentChange speaker={{ name: 'Atlas', avatar: 'compass' }} from="Juniper" />,
    );
    expect(screen.getByText('Atlas took over from Juniper')).toBeInTheDocument();
    // The face is beside its name: decoration.
    expect(screen.queryByRole('img')).toBeNull();
    await expectAccessible(container);
  });
});
