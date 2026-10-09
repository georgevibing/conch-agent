/** `openSettings('access', DEVICES_FOCUS)` brings Settings → Access → Devices, what's signed in and waiting, into view. */
export const DEVICES_FOCUS = 'devices';

/**
 * `openSettings('access', ADD_DEVICE_FOCUS)` opens Add a device (⌘K, Notifications,
 * Repair everything). With no sign-in yet, Access asks for one first, then opens it.
 */
export const ADD_DEVICE_FOCUS = 'add-device';

/** `openSettings('access', REACH_FOCUS)` brings Settings → Access → Use Conch on your phone into view. */
export const REACH_FOCUS = 'reach';

/** `openSettings('access', PASSKEYS_FOCUS)` brings Settings → Access → Passkeys into view (ADR 0065). */
export const PASSKEYS_FOCUS = 'passkeys';

/** `openSettings('access', SIGN_IN_FOCUS)` brings Settings → Access → How you sign in into view, at a password. */
export const SIGN_IN_FOCUS = 'sign-in';

/** `openSettings('access', KEYS_FOCUS)` brings Settings → Access → How you sign in into view, at the access keys. */
export const KEYS_FOCUS = 'keys';

/** `openSettings('security', ADDRESS_FOCUS)` brings Settings → Security → Your address into view (ADR 0064). */
export const ADDRESS_FOCUS = 'address';
