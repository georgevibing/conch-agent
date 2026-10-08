import type { Recipe } from '@conch/protocol';
import { toast, type KitchenTimer, type RecipeData } from '@conch/nacre';

import { attachmentUrl } from './uploads';

/**
 * Recipes from the `recipe` tool, as Nacre draws them: the picture is the
 * chat's own attachment, served by Conch (never a remote address, CSP
 * `img-src 'self'`). Everything else is plain text Nacre draws as text.
 */
export function recipeCards(items: readonly Recipe[]): RecipeData[] {
  return items.map(({ picture, ...recipe }) => ({
    ...recipe,
    ...(picture?.kind === 'image' && {
      picture: { src: attachmentUrl(picture.id), width: picture.width, height: picture.height },
    }),
  }));
}

/**
 * A kitchen timer ended (the card has chimed): say so in Conch, and on the
 * computer too when Conch is in the background and notifications are allowed.
 */
export function recipeTimerDone(timer: KitchenTimer, recipe: RecipeData) {
  const title = `${timer.label} is done`;
  toast(title, { description: recipe.title });
  if (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted' &&
    document.visibilityState === 'hidden'
  ) {
    const n = new Notification(title, { body: recipe.title, tag: timer.id });
    n.onclick = () => window.focus();
  }
}
