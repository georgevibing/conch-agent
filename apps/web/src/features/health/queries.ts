import { useQuery } from '@tanstack/react-query';

import { doctorApi, healthKeys } from './api';

/** The Repair everything report, kept live by the `doctor.report` event. */
export function useDoctor() {
  return useQuery({ queryKey: healthKeys.doctor, queryFn: doctorApi.report, staleTime: 60_000 });
}
