import { describe, expect, it } from 'vitest';

import { notesFrom } from './notes';
import { polish, prompt, readReply } from './polish';

const commits = [
  { sha: 'a1', subject: 'feat(web): edit artifacts by hand with a live preview', body: '' },
  { sha: 'a2', subject: 'feat(server): edit artifacts by hand', body: '' },
  { sha: 'b1', subject: 'fix(web): the composer keeps your draft after a restart', body: '' },
  {
    sha: 'c1',
    subject: 'feat(server)!: settings move to one file',
    body: 'BREAKING CHANGE: Sign in again after updating.',
  },
];
const { notes, groups } = notesFrom(commits);
const index = (section: string) => groups.findIndex((g) => g.section === section);

const reply = (body: object) => `Here you go:\n${JSON.stringify(body)}\n`;

describe('polishing the notes with a model, held to the commits', () => {
  it('asks with the groups, the rules and the draft', () => {
    const text = prompt('0.3.0', groups, notes);
    expect(text).toContain('Conch 0.3.0');
    expect(text).toContain('feat(web): edit artifacts by hand with a live preview');
    expect(text).toContain('Never invent a feature');
    expect(text).toContain('no hype');
  });

  it('takes a good answer: every line traceable, plain, within the limits', () => {
    const read = readReply(
      reply({
        headsUp: [{ text: 'Sign in again after you update', from: [index('headsUp')] }],
        new: [{ text: 'Edit pages by hand, with a live preview', from: [index('new')] }],
        fixed: [{ text: 'Your draft stays put across a restart.', from: [index('fixed')] }],
      }),
      groups,
    );
    expect(read.notes).toEqual({
      headsUp: ['Sign in again after you update'],
      new: ['Edit pages by hand, with a live preview'],
      better: [],
      fixed: ['Your draft stays put across a restart'],
    });
  });

  it('sets aside an answer that invents, hypes, shouts or drops the heads-up', () => {
    const good = { text: 'Edit pages by hand', from: [index('new')] };
    const heads = { text: 'Sign in again', from: [index('headsUp')] };
    expect(
      readReply(reply({ headsUp: [heads], new: [{ text: 'Fly to the moon', from: [99] }] }), groups)
        .problem,
    ).toBe('a line came from nowhere');
    expect(
      readReply(
        reply({ headsUp: [heads], new: [{ text: 'A blazing fast editor', from: [index('new')] }] }),
        groups,
      ).problem,
    ).toBe('a line didn’t read plainly');
    expect(
      readReply(
        reply({ headsUp: [heads], new: [{ text: 'Edit pages by hand!', from: [index('new')] }] }),
        groups,
      ).problem,
    ).toBe('a line didn’t read plainly');
    expect(readReply(reply({ new: [good] }), groups).problem).toBe('the heads-up went missing');
    expect(
      readReply(
        reply({ headsUp: [{ text: 'Edit pages', from: [index('new')] }], new: [good] }),
        groups,
      ).problem,
    ).toBe('a heads-up wasn’t about a breaking change');
    expect(
      readReply(reply({ headsUp: [heads], new: Array(9).fill(good) }), groups).problem,
    ).toMatch(/too many/);
    expect(readReply('I can’t do that.', groups).problem).toBe('the answer wasn’t JSON');
  });

  it('uses Claude Code when it’s here, the API when a key is, and says why it didn’t', async () => {
    const good = reply({
      headsUp: [{ text: 'Sign in again', from: [index('headsUp')] }],
      new: [{ text: 'Edit pages by hand', from: [index('new')] }],
    });
    const api = async () => good;
    expect(
      await polish('0.3.0', groups, notes, { claude: async () => undefined, api, env: {} }),
    ).toMatchObject({
      kind: 'polished',
      by: 'the Anthropic API',
    });
    expect(
      await polish('0.3.0', groups, notes, { claude: async () => undefined, env: {} }),
    ).toEqual({
      kind: 'skipped',
      why: 'no Claude Code or ANTHROPIC_API_KEY here',
    });
    // A "Claude Code" that answers badly: the plain notes stand.
    const fake = process.execPath;
    const result = await polish('0.3.0', groups, notes, { claude: async () => fake, env: {} });
    expect(result.kind).toBe('skipped');
  });
});
