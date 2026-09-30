import type { Integration } from '@conch/protocol';
import { useNavigate } from 'react-router';

import { integrationsApi } from './api';
import { useCheckIntegration, useUpdateIntegration } from './queries';
import { useSignIn } from './useSignIn';

/** The one action that fixes an integration, whatever is wrong with it. */
export function useFix() {
  const signIn = useSignIn();
  const check = useCheckIntegration();
  const update = useUpdateIntegration();
  const navigate = useNavigate();
  return {
    pending: check.isPending ? check.variables : undefined,
    fix(integration: Integration) {
      switch (integration.health.action) {
        case 'reconnect':
          if (integration.auth === 'oauth')
            return void signIn((display) => integrationsApi.connect(integration.id, display));
          return void navigate(`/integrations/${integration.id}`, { state: { focus: 'token' } });
        case 'edit':
          return void navigate(`/integrations/${integration.id}`, { state: { focus: 'token' } });
        case 'turn-on':
          return update.mutate({ id: integration.id, patch: { enabled: true } });
        case 'setup':
          // Its connect dialog shows what's missing and offers to get it.
          return void navigate(`/integrations?setup=${integration.id}`);
        default:
          return check.mutate(integration.id);
      }
    },
  };
}
