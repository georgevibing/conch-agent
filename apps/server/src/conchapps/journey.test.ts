/**
 * The whole journey on the real parts (ADR 0061): no fakes between the
 * service and the sealed runtime, the package reader, the check and the
 * signatures. Make an app in a chat, add it, use it from its page, save it
 * as a file, take it out, and add it back from that file.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConversationEvent, ConversationEventInput } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { tallyFiles } from '../engines/mock/tally';
import { deviceSealer } from '../lib/sealed';
import { SkillTrust } from '../skills/trust';
import { conchAppParts } from './deps';
import { ConchAppService } from './service';

const homes: string[] = [];
const services: ConchAppService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

async function real() {
  const home = await mkdtemp(join(tmpdir(), 'conch-apps-real-'));
  homes.push(home);
  // This computer's key, as `sign.test.ts` gives it: the keychain isn't there in every test run.
  const trust = new SkillTrust(home, { sealer: deviceSealer(async () => Buffer.alloc(32, 7)) });
  const logs = new Map<string, ConversationEvent[]>();
  let seq = 0;
  const push = (id: string, input: ConversationEventInput) => {
    const log = logs.get(id) ?? [];
    logs.set(id, log);
    log.push({ ...input, conversationId: id, seq: seq++, at: Date.now() } as ConversationEvent);
  };
  const service = new ConchAppService({
    home,
    parts: conchAppParts({
      home,
      heal: () => undefined,
      gatewayPort: 1,
      trust: () => trust,
      redact: () => (text) => text,
    }),
    emit: () => undefined,
    heal: () => undefined,
    chats: {
      events: async (id) => logs.get(id) ?? [],
      note: async (id, offer) => push(id, { type: 'conch-app.offer', offer }),
      exists: async (id) => logs.has(id),
      taints: async () => [],
    },
    skillsChanged: () => undefined,
    manualChecks: true,
  });
  services.push(service);
  await service.load();
  const chat = (id = 'c_real') => {
    logs.set(id, logs.get(id) ?? []);
    return { conversationId: id, append: (event: ConversationEventInput) => push(id, event) };
  };
  return { home, service, chat };
}

describe('the whole journey, sealed and real', () => {
  it('starts from a starter that passes once its tool is tried', async () => {
    const { service, chat } = await real();
    const ctx = chat();
    const { draft } = await service.newDraft(ctx.conversationId, {
      name: 'Reading list',
      id: 'reading-list',
    });
    const first = await service.check(draft.id);
    expect(first.problems.map((p) => p.message).join('\n')).toMatch(/app_try/);
    // A try with what a tool needs counts; one that fails doesn't.
    expect((await service.tryTool(draft.id, 'add_note', {})).outcome.ok).toBe(false);
    expect((await service.tryTool(draft.id, 'add_note', { text: 'Dune' })).outcome.ok).toBe(true);
    expect((await service.tryTool(draft.id, 'list_notes', {})).outcome.ok).toBe(true);
    const second = await service.check(draft.id);
    expect(second.problems).toEqual([]);
    expect(second.ok).toBe(true);
  }, 60_000);

  it('makes Tally, adds it, counts from its page, saves it as a file and adds it back', async () => {
    const { service, chat } = await real();
    const ctx = chat();
    const { draft } = await service.newDraft(ctx.conversationId, { name: 'Tally', id: 'tally' });
    for (const [path, content] of Object.entries(tallyFiles('1.0.0')))
      await service.write(draft.id, path, content);
    await service.check(draft.id);
    expect((await service.tryTool(draft.id, 'count', { by: 2 })).outcome.ok).toBe(true);
    expect((await service.tryTool(draft.id, 'read_count', {})).outcome.ok).toBe(true);
    const check = await service.check(draft.id);
    expect(check.problems).toEqual([]);
    const offer = await service.present(ctx, draft.id, 'Tally counts things.');

    const app = await service.acceptOffer(offer.offerId, { conversationId: ctx.conversationId });
    expect(app.tools.map((t) => t.name).sort()).toEqual(['count', 'read_count']);
    // The tools carry their input schemas, so every model knows what to send.
    expect(app.tools.find((t) => t.name === 'count')?.input).toMatchObject({ type: 'object' });

    // The draft's tries ran on scratch data: the added app starts at nothing.
    const zero = await service.callFromPage({ appId: 'tally' }, 'read_count', {}, false);
    expect(zero).toMatchObject({ ok: true });
    // A change from the page needs a press; with one, it counts.
    expect(await service.callFromPage({ appId: 'tally' }, 'count', { by: 1 }, false)).toMatchObject(
      { ok: false, reason: 'confirm' },
    );
    expect(await service.callFromPage({ appId: 'tally' }, 'count', { by: 3 }, true)).toMatchObject({
      ok: true,
    });
    const three = await service.callFromPage({ appId: 'tally' }, 'read_count', {}, false);
    expect(three.ok && three.text).toMatch(/3/);

    // Saved as a file: signed with your key, and Conch reads it back as yours.
    const file = await service.exportFile('tally');
    expect(file.name).toBe('tally.conchapp');
    await service.remove('tally', { keepData: false });
    expect(await service.list()).toEqual([]);

    const preview = await service.preview({
      file: file.bytes.toString('base64'),
      name: file.name,
    });
    const found = preview?.apps[0];
    expect(found?.problems).toEqual([]);
    expect(found?.signature.state).toBe('verified');
    const back = await service.install({
      packageId: preview?.packageId ?? '',
      appId: 'tally',
      hash: found?.hash ?? '',
      settings: {},
    });
    expect(back.source).toEqual({ kind: 'file', name: 'tally.conchapp' });
    // Its data went with it when it was taken out.
    const fresh = await service.callFromPage({ appId: 'tally' }, 'read_count', {}, false);
    expect(fresh.ok && fresh.text).not.toMatch(/\b3\b/);
  }, 90_000);
});
