import { AGENT_AVATAR_ART, AGENT_AVATAR_COLORS, agentAvatarLook } from '@conch/nacre';
import { AGENT_AVATAR_PRESETS, APP_COLORS } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

describe('every face the protocol names, Nacre draws', () => {
  it('has a drawing for every preset, so none falls back to the mark by accident', () => {
    for (const id of AGENT_AVATAR_PRESETS) expect(AGENT_AVATAR_ART[id], id).toBeDefined();
  });

  it('knows every colour an agent may choose', () => {
    expect([...AGENT_AVATAR_COLORS].sort()).toEqual([...APP_COLORS].sort());
    for (const color of APP_COLORS)
      expect(agentAvatarLook({ kind: 'preset', id: 'leaf', color })).toMatchObject({ color });
  });
});
