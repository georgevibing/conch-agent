import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { AppMaker } from './AppMaker';
import { AppPreview, type AppPreviewApp } from './AppPreview';
import { AppVersions } from './AppVersions';
import { CommunityApps, CommunityAppTile } from './CommunityApps';
import {
  coffeeTab,
  coffeeTools,
  coffeeWords,
  community,
  plantDiary,
  plantTools,
  plantWords,
} from './fixtures';
import { ShareSteps } from './ShareSteps';

describe('AppMaker', () => {
  it('builds what was written, by button or by ⌘/Ctrl+Enter', async () => {
    const onBuild = vi.fn();
    const { container } = renderNacre(<AppMaker onBuild={onBuild} />);
    const box = screen.getByRole('textbox', { name: 'What should it do?' });
    const build = screen.getByRole('button', { name: /Build it/ });
    expect(build).toBeDisabled();
    expect(box).toHaveAccessibleDescription(
      'Conch builds it in a chat, shows it to you, and adds it when you say so.',
    );
    await userEvent.type(box, '  Keep my bike’s service log  ');
    await userEvent.click(build);
    expect(onBuild).toHaveBeenLastCalledWith('Keep my bike’s service log');
    await userEvent.click(box);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onBuild).toHaveBeenCalledTimes(2);
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onBuild).toHaveBeenCalledTimes(3);
    // Enter alone is a new line.
    await userEvent.keyboard('{Enter}');
    expect(onBuild).toHaveBeenCalledTimes(3);
    await expectAccessible(container);
  });

  it('fills the box from a chip, and focuses it to carry on writing', async () => {
    renderNacre(<AppMaker onBuild={() => {}} />);
    const ideas = screen.getByRole('group', { name: 'Ideas' });
    expect(
      within(ideas)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'Remember when I water my plants',
      'Track what I spend on coffee',
      'Check if my train is late',
      'Keep a reading list',
      'Log my runs and show my week',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Keep a reading list' }));
    const box = screen.getByRole('textbox', { name: 'What should it do?' });
    expect(box).toHaveValue('Keep a reading list');
    expect(box).toHaveFocus();
  });

  it('turns the hint while the box is empty, and holds still once written in', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = renderNacre(<AppMaker onBuild={() => {}} value="" />);
      const box = screen.getByRole('textbox');
      const first = box.getAttribute('placeholder');
      act(() => vi.advanceTimersByTime(4300));
      const second = box.getAttribute('placeholder');
      expect(second).not.toBe(first);
      rerender(<AppMaker onBuild={() => {}} value="Something" />);
      act(() => vi.advanceTimersByTime(9000));
      expect(box.getAttribute('placeholder')).toBe(second);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds still while the chat is being started', () => {
    const onBuild = vi.fn();
    renderNacre(<AppMaker onBuild={onBuild} defaultValue="Keep a reading list" busy />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Build it/ })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Track what I spend on coffee' })).toBeDisabled();
  });
});

const plant: AppPreviewApp = {
  manifest: plantDiary,
  tools: plantTools,
  signature: { state: 'verified', publisher: 'Ada Lovelace' },
  words: { ...plantWords, from: 'Signed by Ada Lovelace' },
};

const coffee: AppPreviewApp = {
  manifest: coffeeTab,
  tools: coffeeTools,
  signature: { state: 'unsigned' },
  words: coffeeWords,
};

describe('AppPreview', () => {
  it('says where it’s looking while it reads the link', async () => {
    const { container } = renderNacre(
      <AppPreview state="loading" looking="github.com/ada/plant-diary" />,
    );
    expect(
      screen.getByRole('region', { name: 'Looking at github.com/ada/plant-diary…' }),
    ).toHaveAttribute('aria-busy', 'true');
    await expectAccessible(container);
  });

  it('lays one app out like its card, and adds it with what was typed', async () => {
    const onAdd = vi.fn();
    const { container } = renderNacre(
      <AppPreview
        state="ready"
        looking="github.com/ada/plant-diary"
        apps={[plant]}
        onAdd={onAdd}
      />,
    );
    expect(screen.getByRole('region', { name: 'Plant diary' })).toHaveTextContent(
      'Signed by Ada Lovelace · 1.0.0',
    );
    expect(screen.getByRole('list', { name: 'What Plant diary can do' })).toBeInTheDocument();
    expect(screen.getByText('Verified: signed by Ada Lovelace')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('City'), 'Porto');
    await userEvent.click(screen.getByRole('button', { name: 'Add Plant diary to my apps' }));
    expect(onAdd).toHaveBeenCalledWith('plant-diary', { city: 'Porto' });
    await expectAccessible(container);
  });

  it('offers Update for a version you have, with what changed first', () => {
    renderNacre(
      <AppPreview
        state="ready"
        looking="github.com/ada/plant-diary"
        apps={[
          {
            ...plant,
            manifest: { ...plantDiary, version: '1.1.0' },
            installed: '1.0.0',
            saved: ['weatherKey', 'city'],
            changes: { from: '1.0.0', to: '1.1.0', reachesAdded: ['api.gbif.org'] },
            words: { ...plant.words, changes: ['Now also reaches api.gbif.org'] },
          },
        ]}
        onAdd={() => {}}
      />,
    );
    expect(screen.getByText('You have version 1.0.0.')).toBeInTheDocument();
    expect(screen.getByText('Now also reaches api.gbif.org').closest('li')).toHaveAttribute(
      'data-marked',
    );
    expect(screen.queryByLabelText('City')).toBeNull();
    expect(screen.getByRole('button', { name: 'Update Plant diary' })).toBeInTheDocument();
  });

  it('says in words why one can’t be added, and offers no way to add it', () => {
    renderNacre(
      <AppPreview
        state="ready"
        looking="github.com/ada/pool"
        apps={[
          {
            ...coffee,
            problems: [
              { message: 'Its tools reach a site it doesn’t name.', file: 'tools.mjs', line: 3 },
            ],
          },
        ]}
        onAdd={() => {}}
      />,
    );
    const why = screen.getByRole('note', { name: 'Coffee tab can’t be added' });
    expect(why).toHaveTextContent('Its tools reach a site it doesn’t name. (tools.mjs, line 3)');
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
  });

  it('lets you pick from a collection, opening each in place', async () => {
    const onAdd = vi.fn();
    const { container } = renderNacre(
      <AppPreview
        state="ready"
        looking="github.com/ada/conch-apps"
        apps={[coffee, { ...plant, installed: '1.0.0' }]}
        added={[]}
        onAdd={onAdd}
      />,
    );
    expect(
      screen.getByRole('region', { name: '2 apps at github.com/ada/conch-apps' }),
    ).toBeInTheDocument();
    // The one you have says so; the other opens to show what it can do first.
    expect(screen.getByText('You have it')).toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Add Coffee tab…' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(open);
    expect(screen.getByRole('button', { name: 'Hide Coffee tab' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('list', { name: 'What Coffee tab can do' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add Coffee tab to my apps' }));
    expect(onAdd).toHaveBeenCalledWith('coffee-tab', {});
    await expectAccessible(container);
  });

  it('says what went wrong reading the link, with one way on', async () => {
    const onRetry = vi.fn();
    renderNacre(
      <AppPreview
        state="failed"
        looking="github.com/ada/nothing"
        message="That repository is private or gone."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing to add from github.com/ada/nothing',
    );
    expect(screen.getByRole('status')).toHaveTextContent('That repository is private or gone.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('CommunityApps', () => {
  it('shows each app as a tile that opens its preview', async () => {
    const onLook = vi.fn();
    const { container } = renderNacre(<CommunityApps apps={community} onLook={onLook} />);
    expect(
      screen.getByRole('heading', { name: 'From the community', level: 2 }),
    ).toBeInTheDocument();
    const tile = screen.getByRole('article', { name: 'Look at reading-list by grace' });
    expect(tile).toHaveTextContent('42 stars');
    await userEvent.click(within(tile).getByRole('button'));
    expect(onLook).toHaveBeenCalledWith(community[1]);
    expect(screen.getByRole('article', { name: 'Look at plant-diary by ada' })).toHaveTextContent(
      'Added',
    );
    expect(screen.getByText('No description yet.')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('is calm when GitHub limits it or can’t be reached', () => {
    const { rerender } = renderNacre(
      <CommunityApps apps={community.slice(0, 1)} limited onLook={() => {}} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'GitHub asked us to wait a minute. These are from before.',
    );
    rerender(<CommunityApps apps={[]} offline onLook={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'GitHub can’t be reached right now. Conch looks again when you’re back online.',
    );
  });

  it('offers to make it when nobody has shared one', () => {
    renderNacre(
      <CommunityApps
        apps={[]}
        query="pool hours"
        onLook={() => {}}
        emptyAction={<button type="button">Make it</button>}
      />,
    );
    expect(screen.getByText('Nobody has shared an app for “pool hours” yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make it' })).toBeInTheDocument();
  });

  it('a tile shortens a big star count', () => {
    renderNacre(
      <CommunityAppTile
        app={{
          owner: 'linus',
          repo: 'coffee-tab',
          url: 'https://github.com/linus/coffee-tab',
          stars: 1530,
        }}
        onLook={() => {}}
      />,
    );
    expect(screen.getByText('1.5k')).toBeInTheDocument();
  });
});

describe('ShareSteps', () => {
  const base = { name: 'Plant diary', appId: 'plant-diary' };

  it('offers both ways to share, each with a sentence', async () => {
    const onPublish = vi.fn();
    const onSaveFile = vi.fn();
    const { container } = renderNacre(
      <ShareSteps
        {...base}
        state={{ state: 'idle' }}
        onPublish={onPublish}
        onSaveFile={onSaveFile}
      />,
    );
    expect(screen.getByText('plant-diary.conchapp')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish on GitHub' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save as a file' }));
    expect(onPublish).toHaveBeenCalledOnce();
    expect(onSaveFile).toHaveBeenCalledOnce();
    await expectAccessible(container);
  });

  it('asks for GitHub’s app with the need’s own button, or Install', async () => {
    const onInstall = vi.fn();
    const { rerender } = renderNacre(
      <ShareSteps {...base} state={{ state: 'needs-program', need: 'gh' }} onInstall={onInstall} />,
    );
    expect(screen.getByText('Needs GitHub’s app.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Install GitHub’s app' }));
    expect(onInstall).toHaveBeenCalledOnce();
    rerender(
      <ShareSteps
        {...base}
        state={{ state: 'needs-program', need: 'gh' }}
        getIt={<button type="button">Install GitHub CLI</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Install GitHub CLI' })).toBeInTheDocument();
  });

  it('shows the sign-in code with Open GitHub, and says Conch carries on', async () => {
    const { container } = renderNacre(
      <ShareSteps
        {...base}
        state={{
          state: 'needs-sign-in',
          code: 'B1C2-D3E4',
          url: 'https://github.com/login/device',
        }}
      />,
    );
    expect(
      screen.getByRole('group', { name: 'Sign-in code B 1 C 2 - D 3 E 4' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/login/device',
    );
    expect(screen.getByText('Conch carries on by itself when you’re done.')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('never opens a sign-in page that isn’t https', () => {
    renderNacre(
      <ShareSteps
        {...base}
        state={{ state: 'needs-sign-in', code: 'X', url: 'javascript:alert(1)' }}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says the step while publishing, then the address anyone can add it from', async () => {
    const { rerender, container } = renderNacre(
      <ShareSteps {...base} state={{ state: 'publishing', step: 'Making the release v1.2.0' }} />,
    );
    expect(
      screen.getByRole('progressbar', { name: 'Making the release v1.2.0' }),
    ).toBeInTheDocument();
    rerender(
      <ShareSteps
        {...base}
        state={{ state: 'published', url: 'https://github.com/ada/plant-diary', version: '1.2.0' }}
        onPublish={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Plant diary 1.2.0 is on GitHub');
    expect(
      screen.getByRole('link', { name: 'https://github.com/ada/plant-diary (opens in a new tab)' }),
    ).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: 'Copy the address' })).toBeInTheDocument();
    expect(screen.getByText('Anyone with Conch can add it from this address.')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('says why it failed, with Try again', async () => {
    const onPublish = vi.fn();
    renderNacre(
      <ShareSteps
        {...base}
        state={{ state: 'failed', message: 'GitHub said no.' }}
        onPublish={onPublish}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Plant diary wasn’t published');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onPublish).toHaveBeenCalledOnce();
  });
});

describe('AppVersions', () => {
  it('lists what’s kept with Go back, and holds still while it goes back', async () => {
    const onGoBack = vi.fn();
    const at = Date.UTC(2026, 8, 1);
    const { rerender, container } = renderNacre(
      <AppVersions
        name="Plant diary"
        current={{ version: '1.2.0', at }}
        versions={[
          { version: '1.1.0', at },
          { version: '1.0.0', at },
        ]}
        onGoBack={onGoBack}
        formatTime={() => '1 Sep'}
      />,
    );
    expect(screen.getByText('In use')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go back to Plant diary 1.1.0' }));
    expect(onGoBack).toHaveBeenCalledWith('1.1.0');
    await expectAccessible(container);
    rerender(
      <AppVersions
        name="Plant diary"
        current={{ version: '1.2.0', at }}
        versions={[
          { version: '1.1.0', at },
          { version: '1.0.0', at },
        ]}
        onGoBack={onGoBack}
        busy="1.1.0"
      />,
    );
    expect(screen.getByRole('button', { name: 'Go back to Plant diary 1.0.0' })).toBeDisabled();
  });

  it('says when there’s nothing to go back to yet', () => {
    renderNacre(
      <AppVersions
        name="Plant diary"
        current={{ version: '1.0.0', at: 0 }}
        versions={[]}
        onGoBack={() => {}}
      />,
    );
    expect(
      screen.getByText('Earlier versions show here once it’s been updated.'),
    ).toBeInTheDocument();
  });
});
