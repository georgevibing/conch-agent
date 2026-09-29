import type { IntegrationResult } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import type { SignInDisplay } from './api';
import { errorText, putIntegration } from './queries';

const POPUP = 'conch-sign-in';

/** A centred window, opened synchronously in the click so popup blockers allow it. */
function openPopup(): Window | null {
  const width = 520;
  const height = 720;
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 3);
  try {
    return window.open(
      '/integrations/done?opening=1',
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
 * Start (or restart) a sign-in. A small window opens straight away showing
 * Conch's own "opening…" page, then moves to the service's sign-in page once
 * the gateway has it. When popups are blocked — or on phones, where they're
 * awkward — this tab goes there instead and comes back afterwards.
 */
export function useSignIn() {
  const client = useQueryClient();
  return useCallback(
    async (
      start: (display: SignInDisplay) => Promise<IntegrationResult>,
    ): Promise<IntegrationResult | undefined> => {
      const touch = window.matchMedia?.('(pointer: coarse)').matches;
      const popup = touch ? null : openPopup();
      try {
        const result = await start(popup ? 'popup' : 'tab');
        putIntegration(client, result.integration);
        if (!result.authorizeUrl || !isWebUrl(result.authorizeUrl)) {
          popup?.close();
          return result;
        }
        if (popup && !popup.closed) {
          popup.location.href = result.authorizeUrl;
          popup.focus();
        } else {
          window.location.assign(result.authorizeUrl);
        }
        return result;
      } catch (error) {
        popup?.close();
        toast.error(errorText(error, 'Couldn’t start signing in.'));
        return undefined;
      }
    },
    [client],
  );
}
