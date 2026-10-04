import { describe, expect, it, vi } from 'vitest';

import { trayMenu } from './listening';

describe('the tray while it listens for “Hey Conch” (ADR 0078)', () => {
  const actions = { open: vi.fn(), quit: vi.fn() };

  it('says it’s listening first, with one click to stop', () => {
    const stop = vi.fn();
    const menu = trayMenu(actions, stop);
    expect(menu[0]).toMatchObject({ label: 'Listening for “Hey Conch”', enabled: false });
    expect(menu[1]?.label).toBe('Stop listening');
    (menu[1]?.click as () => void)();
    expect(stop).toHaveBeenCalled();
  });

  it('says nothing about listening when it isn’t', () => {
    const labels = trayMenu(actions).map((item) => item.label);
    expect(labels).toEqual(['Open Conch', undefined, 'Quit Conch']);
  });
});
