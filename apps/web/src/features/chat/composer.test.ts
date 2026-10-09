import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  composerHistory,
  forgetDrafts,
  loadDraft,
  loadLocalDraft,
  loadQueue,
  localDraftKeys,
  rememberSent,
  saveDraft,
  saveLocalDraft,
  saveQueue,
} from './composer';

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('drafts', () => {
  it('keeps what was being written in each chat, and lets go of an emptied one once Conch has it', () => {
    saveDraft('c1', 'half a thought');
    saveDraft('c2', 'another');
    expect(loadDraft('c1')).toBe('half a thought');
    expect(loadDraft('c2')).toBe('another');
    expect(localDraftKeys().sort()).toEqual(['c1', 'c2']);
    // Emptied here: kept as empty until Conch has heard, so its old copy can't come back.
    saveDraft('c1', '   ');
    expect(loadDraft('c1').trim()).toBe('');
    expect(loadLocalDraft('c1')).toMatchObject({ synced: false });
    expect(localDraftKeys()).toEqual(['c2']);
    saveLocalDraft('c1', { text: '', synced: true });
    expect(Object.keys(JSON.parse(localStorage.getItem('conch.drafts') ?? '{}'))).toEqual(['c2']);
  });

  it('keeps what is attached and a new chat’s choices with the words', () => {
    const attachment = {
      id: 'att_1',
      name: 'cat.png',
      mimeType: 'image/png',
      size: 10,
      kind: 'image' as const,
      createdAt: 1,
    };
    saveLocalDraft('new', {
      text: 'look',
      attachments: [attachment],
      options: { permissionMode: 'plan' },
      synced: true,
    });
    expect(loadLocalDraft('new')).toMatchObject({
      text: 'look',
      attachments: [attachment],
      options: { permissionMode: 'plan' },
      synced: true,
    });
    // Only the words change: what's attached stays, and it has to go to Conch again.
    saveDraft('new', 'look at this');
    expect(loadLocalDraft('new')).toMatchObject({ attachments: [attachment], synced: false });
    // A draft only of files is still a draft.
    saveLocalDraft('files', { text: '', attachments: [attachment], synced: true });
    expect(localDraftKeys()).toContain('files');
  });

  it('reads a draft from before Conch kept them as one still to send', () => {
    localStorage.setItem('conch.drafts', JSON.stringify({ c1: { text: 'old', at: 1 } }));
    expect(loadLocalDraft('c1')).toEqual({ text: 'old', at: 1, synced: false });
  });

  it('keeps only the most recently written in', () => {
    for (let i = 0; i < 60; i++) {
      vi.spyOn(Date, 'now').mockReturnValue(i);
      saveDraft(`c${i}`, `draft ${i}`);
    }
    expect(loadDraft('c59')).toBe('draft 59');
    expect(loadDraft('c10')).toBe('draft 10');
    expect(loadDraft('c9')).toBe('');
  });

  it('forgets everything when you sign out here', () => {
    saveDraft('c1', 'secret plans');
    rememberSent('hello');
    forgetDrafts();
    expect(loadDraft('c1')).toBe('');
    expect(composerHistory([])).toEqual([]);
  });

  it('shrugs off storage it can’t read or write', () => {
    localStorage.setItem('conch.drafts', '{not json');
    expect(loadDraft('c1')).toBe('');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveDraft('c1', 'still here')).not.toThrow();
    expect(() => rememberSent('hi')).not.toThrow();
  });
});

describe('composerHistory', () => {
  it('puts this chat’s messages nearest, and what was sent elsewhere before them', () => {
    rememberSent('from another chat');
    rememberSent('Plan my week');
    expect(composerHistory(['Plan my week', 'Make it shorter'])).toEqual([
      'from another chat',
      'Plan my week',
      'Make it shorter',
    ]);
  });

  it('makes one step of a message sent twice in a row, and skips empty ones', () => {
    expect(composerHistory(['again', ' again ', '', 'other', 'again'])).toEqual([
      'again',
      'other',
      'again',
    ]);
  });

  it('remembers at most fifty messages from elsewhere, newest last', () => {
    for (let i = 0; i < 55; i++) rememberSent(`m${i}`);
    rememberSent('m10');
    const history = composerHistory([]);
    expect(history).toHaveLength(50);
    expect(history.at(-1)).toBe('m10');
    expect(history[0]).toBe('m5');
  });
});

describe('messages waiting their turn', () => {
  it('survive the page reloading (Conch restarting for an update), per chat, until signing out', () => {
    const waiting = [{ id: 'q1', text: 'then deploy it', attachments: [] }];
    saveQueue('c1', waiting);
    // The reload: a fresh read finds them where they were.
    expect(loadQueue('c1')).toEqual(waiting);
    expect(loadQueue('c2')).toEqual([]);
    saveQueue('c1', []);
    expect(loadQueue('c1')).toEqual([]);
    saveQueue('c1', waiting);
    forgetDrafts();
    expect(loadQueue('c1')).toEqual([]);
  });

  it('skip a damaged entry rather than break the box', () => {
    sessionStorage.setItem('conch.queued', JSON.stringify({ c1: [{ id: 1 }, 'x'] }));
    expect(loadQueue('c1')).toEqual([]);
  });
});
