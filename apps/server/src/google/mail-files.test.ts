import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { MailFile } from './accounts';
import { mailFiles } from './mail-files';

const made: string[] = [];
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function folder() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'conch-mail-files-')));
  made.push(root);
  const work = join(root, 'work');
  await mkdir(join(work, 'reports'), { recursive: true });
  await writeFile(join(work, 'reports', 'statement.pdf'), '%PDF-1.4 statement');
  await writeFile(join(root, 'outside.txt'), 'not yours');
  const conch = join(work, '.conch-home');
  await mkdir(conch);
  await writeFile(join(conch, 'vault.json'), '{}');
  return { root, work, conch };
}

const chatFile: MailFile = { name: 'chart.png', mimeType: 'image/png', bytes: Buffer.from('png') };

describe('the files an email carries (2026-10-27)', () => {
  it('takes this chat’s files by id and the work folder’s by path, in the order named', async () => {
    const { work, conch } = await folder();
    const asked: string[][] = [];
    const files = await mailFiles(['reports/statement.pdf', 'att_abc'], {
      chat: async (ids) => {
        asked.push([...ids]);
        return [chatFile];
      },
      folder: async () => ({ cwd: work, protectedPaths: [conch] }),
    });
    expect(asked).toEqual([['att_abc']]);
    expect(files.map((f) => f.name)).toEqual(['statement.pdf', 'chart.png']);
    expect(files[0]?.mimeType).toBe('application/pdf');
    expect(files[0]?.bytes.toString()).toBe('%PDF-1.4 statement');
  });

  it('never reads outside the work folder, through a link, or from Conch’s own places', async () => {
    const { root, work, conch } = await folder();
    await symlink(join(root, 'outside.txt'), join(work, 'link.txt'));
    const sources = {
      chat: async () => [],
      folder: async () => ({ cwd: work, protectedPaths: [conch] }),
    };
    await expect(mailFiles(['../outside.txt'], sources)).rejects.toThrow(/work folder/);
    await expect(mailFiles([join(root, 'outside.txt')], sources)).rejects.toThrow(/work folder/);
    await expect(mailFiles(['link.txt'], sources)).rejects.toThrow(/can’t go with the email/);
    await expect(mailFiles(['.conch-home/vault.json'], sources)).rejects.toThrow(
      /can’t go with the email/,
    );
  });

  it('refuses a path where only this chat’s files may go', async () => {
    await expect(mailFiles(['notes.txt'], { chat: async () => [] })).rejects.toThrow(/att_/);
  });
});
