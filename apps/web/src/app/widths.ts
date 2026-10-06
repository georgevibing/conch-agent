/**
 * The widths the app changes shape at, in one place. Everything that folds
 * away folds at the same width, so there's never a band where the window has
 * put its sidebar away but a page inside it hasn't (or the other way round).
 *
 * The CSS that follows them says the same number, with this file named beside
 * it: `@media (max-width: 820px)` (Shell, Settings, Routines, Channels,
 * ChatFind) and `@media (max-width: 560px)` (Onboarding, Passwords).
 */

/**
 * Narrow: a sidebar beside the page would leave too little of it, so the
 * places float in over it instead — the chats, and Settings' places.
 */
export const NARROW = '(max-width: 820px)';

/** A phone's width: the header folds what it can into one button. */
export const PHONE = '(max-width: 560px)';
