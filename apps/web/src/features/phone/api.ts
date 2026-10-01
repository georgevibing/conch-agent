import { PhoneAddress } from '@conch/protocol';

import { request } from '../../api/client';

/** Your phone's secure address, over Tailscale (ADR 0027). */
export const phoneApi = {
  address: () => request(PhoneAddress, '/api/phone/address'),
  turnOn: () => request(PhoneAddress, '/api/phone/address', { method: 'POST', body: {} }),
};

export const phoneKeys = { address: ['phone', 'address'] as const };
