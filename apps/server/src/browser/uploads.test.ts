import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fromWorkspace, resolveUploads, UploadRefused, type UploadSources } from './uploads';

let root = '';
let home = '';
let work = '';
let keys = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'conch-uploads-'));
  home = join(root, '.conch');
  work = join(home, 'workspace');
  keys = join(root, '.ssh');
  await mkdir(work, { recursive: true });
  await mkdir(join(home, 'vault'), { recursive: true });
  await mkdir(keys, { recursive: true });
  await writeFile(join(work, 'cv.pdf'), '%PDF-1.4 my cv');
  await mkdir(join(work, 'photos'), { recursive: true });
  await writeFile(join(work, 'photos', 'me.png'), 'png');
  await writeFile(join(work, '.env'), 'OPENAI_API_KEY=sk-' + 'nope');
  await mkdir(join(work, '.git'), { recursive: true });
  await writeFile(join(work, '.git', 'config'), '[remote]');
  await writeFile(join(work, 'id_ed25519'), 'PRIVATE');
  await writeFile(join(work, 'server.pem'), 'PRIVATE');
  await writeFile(join(home, 'secrets.json'), '{"key":"sealed"}');
  await writeFile(join(home, 'vault', 'vault.json'), '{}');
  await writeFile(join(keys, 'id_rsa'), 'PRIVATE');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const sources = (): UploadSources => ({
  home,
  forbidden: [join(home, 'vault'), join(home, 'secrets.json'), keys],
  attachments: () =>
    Promise.resolve([
      {
        id: 'att_1',
        name: 'Passport scan.jpg',
        mimeType: 'image/jpeg',
        read: () => Promise.resolve(Buffer.from('jpeg')),
      },
    ]),
  made: () =>
    Promise.resolve([
      {
        id: 'a_x',
        name: 'Cover letter.md',
        mimeType: 'text/markdown',
        read: () => Promise.resolve(Buffer.from('# Dear…')),
      },
    ]),
});

const refused = async (wanted: string, workspace = work) => {
  const error = await fromWorkspace(wanted, workspace, sources()).catch((e: unknown) => e);
  expect(error, wanted).toBeInstanceOf(UploadRefused);
  return (error as Error).message;
};

describe('what the browser may upload', () => {
  it('takes the chat’s own files by name, and work-folder files by path', async () => {
    const files = await resolveUploads(['passport scan.jpg', 'Cover letter.md', 'photos/me.png'], {
      conversationId: 'c1',
      workspace: work,
      sources: sources(),
    });
    expect(files.map((f) => [f.name, f.mimeType, f.from])).toEqual([
      ['Passport scan.jpg', 'image/jpeg', 'attached in this chat'],
      ['Cover letter.md', 'text/markdown', 'made in this chat'],
      ['me.png', 'image/png', 'photos/me.png'],
    ]);
    expect(String(files[2]?.buffer)).toBe('png');
  });

  it('never leaves the work folder: traversal and absolute paths', async () => {
    expect(await refused('../secrets.json')).toMatch(/isn’t in the work folder/);
    expect(await refused('photos/../../vault/vault.json')).toMatch(/isn’t in the work folder/);
    expect(await refused(join(keys, 'id_rsa'))).toMatch(/isn’t in the work folder/);
    expect(await refused('nothing-here.pdf')).toMatch(/no file/);
  });

  it('never follows a link out of the work folder', async () => {
    // A folder link (a junction on Windows needs no rights), and a file link where allowed.
    await symlink(keys, join(work, 'folder'), 'junction');
    expect(await refused('folder/id_rsa')).toMatch(/isn’t in the work folder/);
    const fileLink = await symlink(join(home, 'secrets.json'), join(work, 'innocent.pdf')).then(
      () => true,
      () => false, // Windows without developer mode makes no file links: nothing to follow.
    );
    if (fileLink) expect(await refused('innocent.pdf')).toMatch(/isn’t in the work folder/);
  });

  it('keeps hidden and key-shaped files for the person to upload', async () => {
    expect(await refused('.env')).toMatch(/hidden file/);
    expect(await refused('.git/config')).toMatch(/hidden file/);
    expect(await refused('id_ed25519')).toMatch(/looks like a key/);
    expect(await refused('server.pem')).toMatch(/looks like a key/);
    expect(await refused('photos')).toMatch(/folder, not a file/);
  });

  it('keeps Conch’s own files and where keys live out, even when the work folder holds them', async () => {
    // A work folder set to the whole home folder: Conch's own and the keys are still out.
    expect(await refused('.conch/secrets.json', root)).toMatch(/Conch’s own files/);
    expect(await refused('.conch/vault/vault.json', root)).toMatch(/Conch’s own files/);
    expect(await refused('.ssh/id_rsa', root)).toMatch(/keys or sign-ins/);
  });

  it('is all or nothing, and has limits', async () => {
    await expect(
      resolveUploads(['cv.pdf', '.env'], {
        conversationId: 'c1',
        workspace: work,
        sources: sources(),
      }),
    ).rejects.toThrow(/hidden file/);
    await expect(
      resolveUploads(
        Array.from({ length: 11 }, () => 'cv.pdf'),
        {
          conversationId: 'c1',
          workspace: work,
          sources: sources(),
        },
      ),
    ).rejects.toThrow(/more than 10 files/);
    await expect(
      resolveUploads([], { conversationId: 'c1', workspace: work, sources: sources() }),
    ).rejects.toThrow(/Say which file/);
  });
});
