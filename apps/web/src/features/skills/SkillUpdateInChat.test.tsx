import type { ToolView } from '@conch/protocol';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, renderApp } from '../../test/harness';
import { SkillUpdateInChat } from './SkillUpdateInChat';

afterEach(() => vi.unstubAllGlobals());
const hash = 'a'.repeat(64);
const view: Extract<ToolView, { kind: 'skill-update' }> = {
  kind: 'skill-update',
  skillId: 'dev-apps',
  title: 'Development previews',
  summary: 'Use devapps.',
  before: 'Use clawapp.',
  instructions: 'Use devapps.',
  expectedHash: hash,
  warnings: [],
};
const skill = {
  id: 'dev-apps',
  name: 'dev-apps',
  title: view.title,
  description: 'Start previews.',
  source: 'conch',
  sourceLabel: 'Conch',
  editable: true,
  mode: 'manual',
  path: '/skills/dev-apps',
  files: [],
  updatedAt: 1,
  instructions: view.before,
  review: { verdict: 'clean', findings: [], hash, checkedAt: 1 },
};

describe('SkillUpdateInChat', () => {
  it('writes only after a press and sends the exact reviewed version', async () => {
    let current = skill;
    const calls = mockFetch({
      'GET /api/skills/dev-apps': () => current,
      'PATCH /api/skills/dev-apps': () => {
        current = { ...skill, instructions: view.instructions };
        return current;
      },
    });
    renderApp(<SkillUpdateInChat view={view} />);
    const button = await screen.findByRole('button', { name: 'Update skill' });
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
    await userEvent.click(button);
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        instructions: view.instructions,
        expectedHash: hash,
      }),
    );
    expect(await screen.findByText('Updated Development previews')).toBeInTheDocument();
  });
  it('replays a saved proposal as complete and refuses stale versions', async () => {
    mockFetch({
      'GET /api/skills/dev-apps': () => ({
        ...skill,
        instructions: 'Newer instructions.',
        review: { ...skill.review, hash: 'b'.repeat(64) },
      }),
    });
    renderApp(<SkillUpdateInChat view={view} />);
    expect(await screen.findByRole('button', { name: 'Update skill' })).toBeDisabled();
    expect(screen.getByText(/changed since this proposal/)).toBeInTheDocument();
  });
});
