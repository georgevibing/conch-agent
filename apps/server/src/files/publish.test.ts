import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolContext } from '../conversations/manager';
import { AttachmentStore } from '../attachments/store';
import { publishTools } from './publish';

const folders: string[] = [];
afterEach(async () => {
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true });
});
describe('finished files', () => {
  it('takes an immutable snapshot, retains it with its chat and removes it with that chat', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-publish-'));
    folders.push(home);
    const cwd = join(home, 'work');
    await mkdir(cwd);
    const store = new AttachmentStore(join(home, 'attachments'));
    await writeFile(join(cwd, 'report.html'), '<h1>Report</h1>');
    const ctx = { conversationId: 'one', signal: new AbortController().signal } as ToolContext;
    const tool = publishTools(ctx, async () => ({ cwd }), store).find(
      (t) => t.name === 'publish_file',
    );
    const result = await tool?.run({ file_path: 'report.html' });
    expect(result).toMatchObject({
      view: { kind: 'downloads', items: [{ name: 'report.html', kind: 'text' }] },
    });
    await writeFile(join(cwd, 'report.html'), 'changed');
    const files = await store.forConversation('one');
    const id = files[0]?.id ?? '';
    const copy = await store.get(id);
    expect(await readFile(copy?.path ?? '', 'utf8')).toBe('<h1>Report</h1>');
    expect(await store.forConversation('two')).toEqual([]);
    expect(await store.discard(id)).toBe(false);
    await store.forget('one', [id]);
    expect(await store.get(id)).toBeUndefined();
  });
});
