import { AgentPresetAvatar } from '@conch/protocol';
import type { AgentPresetFace } from '@conch/nacre';

/**
 * A face chosen in Nacre's picker, as the protocol takes it. The picker only
 * offers the presets Nacre draws, which are the protocol's; anything else
 * (an older Nacre's) is Conch's own shell.
 */
export function asPreset(face: AgentPresetFace): AgentPresetAvatar {
  const parsed = AgentPresetAvatar.safeParse(face);
  return parsed.success ? parsed.data : { kind: 'preset', id: 'shell' };
}
