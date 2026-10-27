import type { ConversationEvent } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { vaultAnswered } from './manager';

const asked = (permissionId: string, envName?: string) =>
  ({
    type: 'permission.requested',
    seq: 1,
    at: 0,
    conversationId: 'c1',
    permissionId,
    toolName: 'process_start',
    input: {},
    summary: 'use the key of “Gh pat giotiskl” in a command',
    vault: {
      action: envName ? 'use' : 'read',
      itemTitle: 'Gh pat giotiskl',
      itemType: 'apiKey',
      fieldLabel: 'Key',
      sensitive: true,
      ...(envName && { envName }),
    },
  }) as unknown as ConversationEvent;

const answered = (permissionId: string, decision: 'allow' | 'allow-always' | 'deny') =>
  ({
    type: 'permission.resolved',
    seq: 2,
    at: 0,
    conversationId: 'c1',
    permissionId,
    decision,
  }) as unknown as ConversationEvent;

const question = { itemTitle: 'Gh pat giotiskl', fieldLabel: 'Key', envName: 'GH_TOKEN' };

describe('a Passwords yes kept in the chat’s log (ADR 0151)', () => {
  it('holds for the same item, field and variable', () => {
    expect(vaultAnswered([asked('p1', 'GH_TOKEN'), answered('p1', 'allow')], question)).toBe(true);
  });

  it('not after a no, nor for another variable or a read', () => {
    expect(vaultAnswered([asked('p1', 'GH_TOKEN'), answered('p1', 'deny')], question)).toBe(false);
    expect(vaultAnswered([asked('p1', 'GITHUB_TOKEN'), answered('p1', 'allow')], question)).toBe(
      false,
    );
    expect(vaultAnswered([asked('p1'), answered('p1', 'allow')], question)).toBe(false);
  });
});
