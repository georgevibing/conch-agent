/**
 * `openSettings('security', AUTO_ENVIRONMENT_FOCUS)` opens Safety at what Auto should know
 * about where you work (ADR 0149).
 */
export const AUTO_ENVIRONMENT_FOCUS = 'auto-environment';

/** `openSettings('security', AUTO_LIFTED_FOCUS)`: what Auto never asks about again (ADR 0149). */
export const AUTO_LIFTED_FOCUS = 'auto-lifted';

/** Every place in Safety ⌘K can open, so Security's Advanced opens for them. */
export const SAFETY_FOCUSES = [AUTO_ENVIRONMENT_FOCUS, AUTO_LIFTED_FOCUS];
