import { DoctorReport } from '@conch/protocol';

import { request } from '../../api/client';

/** Repair everything (see `apps/server/src/doctor/`). Both return at once; the report fills in live. */
export const doctorApi = {
  report: () => request(DoctorReport, '/api/doctor'),
  check: () => request(DoctorReport, '/api/doctor/check', { method: 'POST', body: {} }),
  repair: () => request(DoctorReport, '/api/doctor/repair', { method: 'POST', body: {} }),
};

export const healthKeys = { doctor: ['doctor'] as const };
