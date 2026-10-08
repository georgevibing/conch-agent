import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isPastChatId } from '@conch/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SearchIndex } from '../../search/index';
import { claudeCode } from './claude';
import { codex } from './codex';
import { copilotChats } from './copilot';
import { pastChatsCheck } from './doctor';
import {
  CLAUDE_SESSION,
  claudeHome,
  codexHome,
  copilotHome,
  everyAppHome,
  geminiHome,
  hermesChatsHome,
  openClawChatsHome,
  openCodeHome,
  PASTED_KEY,
} from './fixtures';
import { geminiCli } from './gemini';
import { hermesChats } from './hermes';
import { opencode } from './opencode';
import { openclawChats } from './openclaw';
import { type ChatFinder, personWords } from './read';
import { ChatImportService } from './service';
import { PAST_DIR, pastChatId, PastChatStore } from './store';

let root: string;
let home: string;
let conch: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conch-pastchats-'));
  home = join(root, 'home');
  conch = join(root, 'conch');
  mkdirSync(home);
  mkdirSync(conch);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Everything one app's finder finds and reads, as words. */
async function readAll(finder: ChatFinder) {
  const files = await finder.find(home, {});
  const out = [];
  for (const f of files) out.push({ file: f, session: await finder.read(f) });
  return out;
}

const said = (s: { messages: { role: string; text: string }[] } | undefined) =>
  s?.messages.map((m) => `${m.role}: ${m.text}`);

describe('reading each app’s past chats', () => {
  it('reads Claude Code: your words and its replies, never its steps, thinking or helpers', async () => {
    claudeHome(home);
    const found = await readAll(claudeCode);
    const chat = found.find((f) => f.file.key === CLAUDE_SESSION);
    expect(found.map((f) => f.file.key).sort()).toEqual([CLAUDE_SESSION, 'empty-session']);
    expect(chat?.file.project).toBe('shop');
    expect(chat?.session).toMatchObject({
      title: 'Checkout double charge',
      cwd: '/Users/me/shop',
      model: 'claude-sonnet-4-5',
    });
    expect(said(chat?.session)).toEqual([
      `user: Why does the checkout page double-charge? My key is ${PASTED_KEY}`,
      'assistant: The retry runs before the lock is taken.',
      'assistant: Move the lock up a line and it charges once.',
    ]);
    expect(found.find((f) => f.file.key === 'empty-session')?.session).toBeUndefined();
  });

  it('reads Codex, squeezed and from before the wrapper too, with the title it gave', async () => {
    codexHome(home);
    const found = await readAll(codex);
    expect(found).toHaveLength(2);
    const now = found.find((f) => f.file.key.startsWith('01a0'));
    expect(now?.session).toMatchObject({ title: 'Garden watering', model: 'gpt-5-codex' });
    expect(now?.file.project).toBe('garden');
    expect(said(now?.session)).toEqual([
      'user: Plan the watering schedule',
      'assistant: Water the tomatoes at dawn.',
    ]);
    const old = found.find((f) => f.file.path.endsWith('.zst'));
    expect(said(old?.session)).toEqual([
      'user: Rename the photos by date',
      'assistant: Done: 42 photos renamed.',
    ]);
  });

  it('reads Gemini CLI’s change log in order, and a whole file from before it', async () => {
    geminiHome(home);
    const found = await readAll(geminiCli);
    const log = found.find((f) => f.file.path.endsWith('.jsonl') && f.session);
    expect(log?.file.project).toBe('novel');
    expect(log?.session).toMatchObject({ title: 'Naming the villain', model: 'gemini-2.5-pro' });
    expect(said(log?.session)).toEqual([
      'user: Name the villain',
      'assistant: Call her Mara Vell.',
    ]);
    const whole = found.find((f) => f.file.path.endsWith('.json'));
    expect(whole?.file.project).toBeUndefined();
    expect(said(whole?.session)).toEqual([
      'user: Translate the letter',
      'assistant: Here it is in French.',
    ]);
    // The helper's session is found but holds no chat of yours.
    expect(found.filter((f) => f.session)).toHaveLength(2);
  });

  it('reads OpenCode’s database and its older files, never a helper’s subtask', async () => {
    openCodeHome(home);
    const found = await readAll(opencode);
    expect(found.map((f) => f.file.key).sort()).toEqual(['ses_1', 'ses_old']);
    const now = found.find((f) => f.file.key === 'ses_1');
    expect(now?.session).toMatchObject({ title: 'Rate limits', model: 'claude-opus-4' });
    expect(now?.file.project).toBe('api');
    expect(said(now?.session)).toEqual([
      'user: Add a rate limit to the API',
      'assistant: Added: 100 requests a minute.',
    ]);
    expect(said(found.find((f) => f.file.key === 'ses_old')?.session)).toEqual([
      'user: Fix the RSS feed',
      'assistant: The feed is valid now.',
    ]);
  });

  it('reads OpenClaw, squeezed events too, never a routine’s run or a group', async () => {
    openClawChatsHome(home);
    const found = await readAll(openclawChats);
    expect(found.map((f) => f.file.key).sort()).toEqual(['main/legacy-1', 'main/s1']);
    const trip = found.find((f) => f.file.key === 'main/s1');
    expect(trip?.session).toMatchObject({ title: 'Lisbon trip', cwd: '/Users/me/trip' });
    expect(said(trip?.session)).toEqual([
      'user: Find a hotel near Alfama',
      'assistant: Memmo Alfama has a terrace.',
    ]);
  });

  it('reads Hermes, a reply that came as items too, never a routine’s run', async () => {
    hermesChatsHome(home);
    const found = await readAll(hermesChats);
    expect(found.map((f) => f.file.key)).toEqual(['default/20260701_090000_ab']);
    expect(found[0]?.session).toMatchObject({ title: 'Tax return', model: 'hermes-4' });
    expect(said(found[0]?.session)).toEqual([
      'user: Which receipts do I need?',
      'assistant: Keep the pharmacy ones.',
    ]);
  });

  it('reads Copilot Chat, and its change log without reaching any prototype', async () => {
    copilotHome(home);
    const found = await readAll(copilotChats);
    expect(found.map((f) => f.file.key).sort()).toEqual(['one', 'two']);
    const one = found.find((f) => f.file.key === 'one');
    expect(one?.file.project).toBe('site');
    expect(said(one?.session)).toEqual(['user: Center the header', 'assistant: Use flexbox.']);
    const two = found.find((f) => f.file.key === 'two');
    expect(two?.session?.title).toBe('Slow build');
    expect(said(two?.session)).toEqual([
      'user: Why is the build slow?',
      'assistant: Source maps are on.',
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('finds nothing, and never fails, where an app isn’t', async () => {
    for (const finder of [
      claudeCode,
      codex,
      geminiCli,
      opencode,
      copilotChats,
      openclawChats,
      hermesChats,
    ])
      expect(await finder.find(home, {})).toEqual([]);
  });

  it('reads a database it can’t open as nothing, not a failure', async () => {
    mkdirSync(join(home, '.hermes'), { recursive: true });
    writeFileSync(join(home, '.hermes', 'state.db'), 'not a database');
    expect(await hermesChats.find(home, {})).toEqual([]);
  });

  it('takes out what a program put in the chat, keeping your words', () => {
    expect(
      personWords(
        '<system-reminder>be good</system-reminder>\n<command-name>/x</command-name>Fix it',
      ),
    ).toBe('Fix it');
  });
});

describe('bringing them in', () => {
  const service = (extra: Partial<ConstructorParameters<typeof ChatImportService>[0]> = {}) =>
    new ChatImportService({ store: new PastChatStore(conch), sourceHome: home, env: {}, ...extra });

  it('says what it found per app and project, then brings it all in once', async () => {
    everyAppHome(home);
    let changed = 0;
    const chats = service({ changed: () => (changed += 1) });
    const before = await chats.status();
    expect(before.brought).toBe(0);
    const claude = before.sources.find((s) => s.id === 'claude-code');
    expect(claude).toMatchObject({ label: 'Claude Code', found: 2, fresh: 2 });
    // The empty one never said where it was.
    expect(claude?.projects).toEqual([{ name: 'shop', count: 1 }]);
    expect(before.sources.map((s) => s.id)).toEqual([
      'claude-code',
      'codex',
      'gemini-cli',
      'opencode',
      'copilot',
      'openclaw',
      'hermes',
    ]);

    const run = await chats.start();
    expect(run).toMatchObject({ added: 12, updated: 0, skipped: 0 });
    expect(run.redacted).toBeGreaterThan(0);
    expect(changed).toBeGreaterThan(0);

    const after = await chats.status();
    expect(after.brought).toBe(12);
    expect(after.sources.every((s) => s.fresh === 0)).toBe(true);
    // A file read with nothing in it isn't counted as a conversation any more.
    expect(after.sources.find((s) => s.id === 'claude-code')?.found).toBe(1);

    // Again: nothing new, nothing doubled.
    expect(await chats.start()).toMatchObject({ added: 0, updated: 0 });
    expect((await chats.list()).length).toBe(12);
  });

  it('never keeps a secret, and keeps the same id for the same chat', async () => {
    claudeHome(home);
    const chats = service();
    await chats.start();
    const id = pastChatId('claude-code', CLAUDE_SESSION);
    expect(isPastChatId(id)).toBe(true);
    const detail = await chats.detail(id);
    expect(detail?.chat).toMatchObject({ title: 'Checkout double charge', project: 'shop' });
    expect(detail?.messages[0]?.text).toContain('My key is •••');
    const raw = readFileSync(join(conch, PAST_DIR, `${id}.jsonl`), 'utf8');
    expect(raw).not.toContain(PASTED_KEY.slice(10));
  });

  it('takes out what Passwords knows, too', async () => {
    claudeHome(home);
    const chats = service({ redact: (t) => t.replaceAll('checkout', '•••') });
    await chats.start();
    const detail = await chats.detail(pastChatId('claude-code', CLAUDE_SESSION));
    expect(detail?.messages[0]?.text).toContain('the ••• page');
  });

  it('reads only what grew since last time', async () => {
    const path = claudeHome(home);
    const chats = service();
    await chats.start();
    appendFileSync(
      path,
      `${JSON.stringify({
        type: 'user',
        cwd: '/Users/me/shop',
        sessionId: CLAUDE_SESSION,
        timestamp: '2026-03-02T10:00:00.000Z',
        message: { role: 'user', content: 'And the refund page?' },
      })}\n`,
    );
    expect((await chats.status()).sources[0]?.fresh).toBe(1);
    const run = await chats.start();
    expect(run).toMatchObject({ added: 0, updated: 1 });
    const detail = await chats.detail(pastChatId('claude-code', CLAUDE_SESSION));
    expect(detail?.messages.at(-1)?.text).toBe('And the refund page?');
  });

  it('leaves out the sessions behind Conch’s own chats', async () => {
    claudeHome(home);
    const chats = service({ ownSessions: async () => new Set([CLAUDE_SESSION]) });
    const status = await chats.status();
    expect(status.sources[0]?.found).toBe(1);
    expect((await chats.start()).added).toBe(0);
  });

  it('skips a file that won’t read, and brings the rest', async () => {
    everyAppHome(home);
    const broken: ChatFinder = {
      id: 'claude-code',
      find: async () => [{ source: 'claude-code', key: 'x', path: '/nope', size: 1, mtimeMs: 1 }],
      read: async () => {
        throw new Error('a shape never seen');
      },
    };
    const chats = service({ finders: [broken, codex] });
    expect(await chats.start()).toMatchObject({ added: 2, skipped: 1 });
  });

  it('keeps up by itself once you’ve said yes, and not before', async () => {
    claudeHome(home);
    const chats = service();
    expect(await chats.keepUp()).toBeUndefined();
    await chats.start();
    codexHome(home);
    // Codex wasn't brought in before: only the apps you brought chats from follow.
    expect(await chats.keepUp()).toBeUndefined();
  });

  it('takes them all out again, leaving the other apps’ files as they were', async () => {
    const path = claudeHome(home);
    const before = readFileSync(path, 'utf8');
    const chats = service();
    await chats.start();
    expect(await chats.removeAll()).toBe(1);
    expect(await chats.list()).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect((await chats.status()).sources[0]?.fresh).toBe(2);
  });

  it('carries a past chat on through Conch', async () => {
    claudeHome(home);
    const seen: string[] = [];
    const chats = service({
      carryOn: async (chat) => {
        seen.push(`${chat.chat.source}:${chat.messages.length}`);
        return 'c_new';
      },
    });
    await chats.start();
    expect(await chats.carryOn(pastChatId('claude-code', CLAUDE_SESSION))).toBe('c_new');
    expect(seen).toEqual(['claude-code:3']);
    await expect(chats.carryOn('pc_0000000000000000')).rejects.toThrow(/isn’t in Conch/);
  });
});

describe('the store', () => {
  it('lists a past chat again from its log when the list is damaged', async () => {
    claudeHome(home);
    const store = new PastChatStore(conch);
    await new ChatImportService({ store, sourceHome: home, env: {} }).start();
    writeFileSync(join(conch, PAST_DIR, 'index.json'), '{ damaged');
    const notes: string[] = [];
    const again = new PastChatStore(conch, (_area, message) => notes.push(message));
    const list = await again.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: 'claude-code', title: 'Checkout double charge' });
    expect(notes).toEqual(['Rebuilt the list of chats you brought in']);
  });

  it('is found by search like any chat', async () => {
    claudeHome(home);
    const store = new PastChatStore(conch);
    await new ChatImportService({ store, sourceHome: home, env: {} }).start();
    const index = new SearchIndex(':memory:');
    for (const chat of await store.list()) index.index(chat, await store.events(chat.id));
    const results = index.search('lock up');
    expect(results.groups[0]?.conversationId).toBe(pastChatId('claude-code', CLAUDE_SESSION));
    index.close();
  });
});

describe('Repair everything', () => {
  it('says when chats are waiting, and brings the new ones once you’ve said yes', async () => {
    claudeHome(home);
    const chats = new ChatImportService({
      store: new PastChatStore(conch),
      sourceHome: home,
      env: {},
    });
    const check = pastChatsCheck(chats);
    const signal = new AbortController().signal;
    const items = await check.run({ repair: false, signal });
    expect(items[0]).toMatchObject({
      state: 'off',
      message: expect.stringContaining('Claude Code'),
    });
    await chats.start();
    expect(await check.run({ repair: false, signal })).toEqual([]);
  });
});
