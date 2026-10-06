/** `openSettings('devices', DEVICES_FOCUS)` brings Settings → Devices, what's signed in and waiting, into view. */
export const DEVICES_FOCUS = 'devices';

/**
 * `openSettings('devices', ADD_DEVICE_FOCUS)` opens Add a device (⌘K, Notifications,
 * Repair everything). With no sign-in yet, Security asks for one first, then comes back.
 */
export const ADD_DEVICE_FOCUS = 'add-device';

/** `openSettings('devices', REACH_FOCUS)` brings Settings → Devices → Use Conch on your phone into view. */
export const REACH_FOCUS = 'reach';

/** `openSettings('security', PASSKEYS_FOCUS)` brings Settings → Security → Passkeys into view (ADR 0065). */
export const PASSKEYS_FOCUS = 'passkeys';

/** `openSettings('security', ADDRESS_FOCUS)` brings Settings → Security → Your address into view (ADR 0064). */
export const ADDRESS_FOCUS = 'address';
