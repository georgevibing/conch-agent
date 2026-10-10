import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addToChangelog,
  changelogFor,
  changelogSection,
  cleanLine,
  groups,
  notesFrom,
  parseNotes,
  releaseBody,
  tagMessage,
} from './notes';
import {
  channelOf,
  inChannel,
  isBreaking,
  offered,
  parseRelease,
  releaseOfTag,
  type Commit,
} from './semver';

let n = 0;
const c = (subject: string, body = ''): Commit => ({
  sha: `${(n++).toString(16).padStart(7, '0')}`,
  subject,
  body,
});

/** This repository's own history, as it was before releases (newest first). */
const HISTORY: Commit[] = readFileSync(join(import.meta.dirname, 'fixtures', 'history.txt'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [sha = '', subject = ''] = line.split('\x1f');
    return { sha, subject, body: '' };
  });

/** A version the test knows is good. */
function must(version: string) {
  const release = parseRelease(version);
  if (!release) throw new Error(`Not a version: ${version}`);
  return release;
}

describe('release numbers', () => {
  it('reads versions and tags strictly', () => {
    expect(parseRelease('0.3.0')).toEqual({ version: '0.3.0', major: 0, minor: 3, patch: 0 });
    expect(parseRelease('0.4.0-beta.2')).toMatchObject({ pre: { kind: 'beta', n: 2 } });
    for (const bad of [
      '0.3',
      '00.3.0',
      '0.3.0-rc.1',
      '0.3.0-beta',
      '0.3.0-beta.0',
      'v0.3.0',
      '0.3.0+x',
      '1.2.3 ',
    ])
      expect(parseRelease(bad.trimEnd() === bad ? bad : `${bad}x`), bad).toBeUndefined();
    expect(releaseOfTag('v0.3.0')?.version).toBe('0.3.0');
    expect(releaseOfTag('0.3.0')).toBeUndefined();
    expect(releaseOfTag('v0.3.0^{}')).toBeUndefined();
  });

  it('puts each release in its channel', () => {
    const [stable, beta, alpha] = [must('1.0.0'), must('1.1.0-beta.1'), must('1.1.0-alpha.3')];
    expect([stable, beta, alpha].map(channelOf)).toEqual(['stable', 'beta', 'alpha']);
    expect(inChannel(stable, 'stable')).toBe(true);
    expect(inChannel(beta, 'stable')).toBe(false);
    expect(inChannel(beta, 'beta')).toBe(true);
    expect(inChannel(alpha, 'beta')).toBe(false);
    expect(inChannel(alpha, 'alpha')).toBe(true);
  });

  it('offers the newest in the channel above this one, never a failed one, never older', () => {
    const all = [
      '0.2.0',
      '0.3.0',
      '0.10.0',
      '0.11.0-beta.2',
      '0.11.0-beta.10',
      '0.12.0-alpha.1',
    ].map((v) => ({ release: must(v) }));
    const pick = (channel: 'stable' | 'beta' | 'alpha', current: string, failed: string[] = []) =>
      offered(all, { channel, current, failed }).map((o) => o.release.version);
    expect(pick('stable', '0.3.0')).toEqual(['0.10.0']);
    expect(pick('beta', '0.3.0')).toEqual(['0.11.0-beta.10', '0.11.0-beta.2', '0.10.0']);
    expect(pick('alpha', '0.11.0-beta.10')).toEqual(['0.12.0-alpha.1']);
    expect(pick('stable', '0.3.0', ['0.10.0'])).toEqual([]);
    // Ahead of every stable release: nothing, rather than going back.
    expect(pick('stable', '0.11.0-beta.2')).toEqual([]);
  });

  it('knows a breaking change by its ! or its footer', () => {
    expect(isBreaking(c('fix: a'))).toBe(false);
    expect(isBreaking(c('feat!: a'))).toBe(true);
    expect(isBreaking(c('feat(web)!: a'))).toBe(true);
    expect(isBreaking(c('fix: a', 'BREAKING CHANGE: sign in again'))).toBe(true);
  });
});

describe('notes from commits', () => {
  it('speaks plainly: no ADRs, no "and its tests", short', () => {
    expect(cleanLine('Show me (ADR 0034) — the panel beside the chat')).toBe(
      'Show me — the panel beside the chat',
    );
    expect(cleanLine('the public door in the security checkup, and its tests')).toBe(
      'The public door in the security checkup',
    );
    expect(cleanLine('do it in the background (⌘⇧↩, ⌘K), live cards')).toBe(
      'Do it in the background, live cards',
    );
    const long = cleanLine(`a list of ${'things, '.repeat(20)}and more`);
    expect(long?.length).toBeLessThanOrEqual(96);
  });

  it('leaves out housekeeping, and makes one line of a feature’s commits across the code', () => {
    const { notes, groups: found } = notesFrom([
      c('docs: Teams, Matrix and WeChat (ADR 0045)'),
      c('test(e2e): Teams, Matrix and WeChat journeys'),
      c('feat(server): the public door in the security checkup, and its tests'),
      c('feat(web): connect Teams, Matrix and WeChat'),
      c('feat(nacre): PublicDoor, and WeChat’s mark'),
      c('feat(server): Teams, Matrix and WeChat channels behind one public door'),
      c('feat(protocol): Teams, Matrix and WeChat channels, and the public door'),
      c('refactor(channels): one way for accounts that are your own'),
      c('chore: tidy'),
      c('fix(ci): bound check concurrency'),
      c('fix(web): the composer keeps your draft'),
    ]);
    expect(notes).toEqual({
      headsUp: [],
      new: ['Connect Teams, Matrix and WeChat'],
      better: [],
      fixed: ['The composer keeps your draft'],
    });
    expect(found[0]?.commits).toHaveLength(5);
  });

  it('a fix to something new in the same release is part of it, not a fix anyone saw', () => {
    const { notes } = notesFrom([
      c('fix(nacre): the editor hears mod+S and Esc before anything else'),
      c('test(e2e): editing by hand'),
      c('feat(web): edit artifacts by hand with a live preview'),
      c('feat(nacre): mod+S and Esc from anywhere in the editor'),
      c('feat(server): edit artifacts by hand'),
    ]);
    expect(notes.new).toEqual(['Edit artifacts by hand with a live preview']);
    expect(notes.fixed).toEqual([]);
  });

  it('a feature only a component knows about isn’t one yet; improvements read as Better', () => {
    const { notes } = notesFrom([
      c('feat(nacre): ChannelSoon says why an app can’t be picked'),
      c('feat(web): faster search in long chats'),
      c('perf(server): memories come back sooner'),
    ]);
    expect(notes.new).toEqual([]);
    expect(notes.better).toEqual(
      expect.arrayContaining(['Faster search in long chats', 'Memories come back sooner']),
    );
  });

  it('a breaking change is a heads-up that says what to do', () => {
    const { notes } = notesFrom([
      c(
        'feat(server)!: settings move to one file',
        'BREAKING CHANGE: Sign in again after updating.',
      ),
      c('fix(web): a typo'),
    ]);
    expect(notes.headsUp).toEqual(['Sign in again after updating']);
  });

  it('keeps a long heads-up to whole sentences, never half of one', () => {
    const { notes } = notesFrom([
      c(
        'feat(server)!: a browser is let in once Conch opened it',
        'BREAKING CHANGE: A browser on the computer running Conch is let in once Conch has opened it. If you typed the address yourself and see "Open Conch from your apps", do that once, or run `pnpm conch open`. Scripts need this computer’s key now.',
      ),
    ]);
    expect(notes.headsUp).toEqual([
      'A browser on the computer running Conch is let in once Conch has opened it',
    ]);
    expect(parseNotes(releaseBody(notes)).headsUp).toEqual(notes.headsUp);
  });

  it('keeps each group to a few lines, and the rest in one', () => {
    const words = [
      'apples',
      'bridges',
      'candles',
      'dragons',
      'engines',
      'forests',
      'gardens',
      'harbours',
      'islands',
      'jackets',
      'kettles',
      'lanterns',
    ];
    const many = words.map((w) => c(`fix(server): ${w}`));
    const { notes } = notesFrom(many);
    expect(notes.fixed).toHaveLength(5);
    expect(notes.fixed.at(-1)).toBe('And 8 fixes');
    expect(notesFrom([c('chore: only housekeeping')]).notes.better).toEqual([
      'Work behind the scenes to keep Conch running well',
    ]);
  });

  it('from this repository’s real history: the last sixty commits', () => {
    const { notes } = notesFrom(HISTORY.slice(0, 60));
    expect(notes).toEqual({
      headsUp: [],
      new: [
        'Edit artifacts by hand with a live preview, and live data',
        'Show and stop what a chat is held to',
        'Connect Teams, Matrix and WeChat',
        'Connect iMessage and email',
        'Link WhatsApp and Signal by scanning a code',
        'Get meaning search in one press, and find it in ⌘K',
        'Finish a half Slack bot from Come home',
      ],
      better: [],
      fixed: ['On a mail server of your own, your address needs the Sent-mail proof'],
    });
  });

  it('from this repository’s whole history: short, plain, never housekeeping', () => {
    const { notes, groups: found } = notesFrom(HISTORY);
    const lines = [...notes.new, ...notes.better, ...notes.fixed];
    expect(notes.new).toHaveLength(8);
    expect(notes.new.at(-1)).toMatch(/^And \d+ new things$/);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(96);
      expect(line).not.toMatch(/ADR|\(#\d+\)|and its tests|^(Chore|Test|Docs)\b/);
    }
    // Every commit worth telling is in exactly one group.
    const told = found.flatMap((g) => g.commits.map((x) => x.sha));
    expect(new Set(told).size).toBe(told.length);
    expect(groups(HISTORY).length).toBeGreaterThan(30);
  });
});

describe('writing the notes down, and reading them back', () => {
  const notes = {
    headsUp: ['Sign in again'],
    new: ['Edit pages by hand'],
    better: [],
    fixed: ['A typo'],
  };

  it('the tag says it in plain words (no # for git to strip)', () => {
    expect(tagMessage('0.3.0', notes)).toBe(
      'Conch 0.3.0\n\nHeads up\n- Sign in again\n\nNew\n- Edit pages by hand\n\nFixed\n- A typo\n',
    );
    expect(releaseBody(notes)).toBe(
      '### Heads up\n\n- Sign in again\n\n### New\n\n- Edit pages by hand\n\n### Fixed\n\n- A typo\n',
    );
  });

  it('CHANGELOG.md has the newest on top', () => {
    const one = addToChangelog(undefined, changelogSection('0.3.0', '2026-10-02', notes));
    const two = addToChangelog(
      one,
      changelogSection('0.4.0', '2026-11-01', { ...notes, headsUp: [] }),
    );
    expect(two.indexOf('## 0.4.0')).toBeLessThan(two.indexOf('## 0.3.0'));
    expect(two.startsWith('# What’s new in Conch')).toBe(true);
    expect(parseNotes(changelogFor(two, '0.3.0') ?? '')).toEqual(notes);
    expect(changelogFor(two, '0.3')).toBeUndefined();
  });

  it('reads notes from upstream strictly', () => {
    expect(parseNotes(tagMessage('0.3.0', notes))).toEqual(notes);
    const hostile = `Conch 0.3.0\n\nNew\n- ${'x'.repeat(500)}\n- with a \u0007bell and ‮flip\nSomething else\n- not a section\nEvil\n- nope\n`;
    const read = parseNotes(hostile);
    expect(read.new[0]).toHaveLength(160);
    expect(read.new[1]).toBe('with a bell and flip');
    expect(read.new).toHaveLength(2);
    expect(parseNotes(`New\n${'- a\n'.repeat(40)}`).new).toHaveLength(12);
  });
});
