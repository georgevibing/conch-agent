import type { Provider } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useCallback } from 'react';

import { providersApi } from './api';
import { errorText } from './queries';

const POPUP = 'conch-provider-sign-in';

/** A centred window, opened synchronously in the click so popup blockers allow it. */
function openPopup(): Window | null {
  const width = 520;
  const height = 720;
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 3);
  try {
    return window.open(
      '/providers/done?opening=1',
      POPUP,
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
  } catch {
    return null;
  }
}

/** Only ever send the browser to a web page — never `javascript:` or anything else. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Let a provider make a key for you. A small window opens straight away on
 * Conch's own "opening…" page, then moves to the provider once the gateway has
 * the address. When popups are blocked — or on phones, where they're awkward —
 * this tab goes instead and comes back afterwards.
 */
export function useProviderSignIn() {
  return useCallback(async (provider: Provider) => {
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    const popup = touch ? null : openPopup();
    try {
      const { authorizeUrl } = await providersApi.signIn(provider.id, popup ? 'popup' : 'tab');
      if (!isWebUrl(authorizeUrl)) {
        popup?.close();
        toast.error('That sign-in address didn’t look right, so Conch didn’t open it.');
        return;
      }
      if (popup && !popup.closed) {
        popup.location.href = authorizeUrl;
        popup.focus();
      } else {
        window.location.assign(authorizeUrl);
      }
    } catch (error) {
      popup?.close();
      toast.error(errorText(error, 'Couldn’t start signing in.'));
    }
  }, []);
}
