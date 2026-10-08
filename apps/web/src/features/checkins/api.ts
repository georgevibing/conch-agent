import {
  CheckInStatus,
  StandingOrder,
  StandingOrders,
  type CheckInBody,
  type StandingOrderKind,
} from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError, request } from '../../api/client';

/** Standing orders and the check-in (ADR 0107): a person's choices, never the assistant's. */
export const checkInApi = {
  orders: () => request(StandingOrders, '/api/standing-orders'),
  add: (text: string, kind?: StandingOrderKind) =>
    request(StandingOrder, '/api/standing-orders', {
      method: 'POST',
      body: { text, ...(kind && { kind }) },
    }),
  change: (id: string, patch: { text?: string; kind?: StandingOrderKind; state?: 'on' | 'off' }) =>
    request(StandingOrder, `/api/standing-orders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    }),
  remove: (id: string) =>
    request(z.object({ ok: z.boolean() }), `/api/standing-orders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  status: () => request(CheckInStatus, '/api/checkin'),
  configure: (body: CheckInBody) => request(CheckInStatus, '/api/checkin', { method: 'PUT', body }),
  look: () => request(CheckInStatus, '/api/checkin/look', { method: 'POST', body: {} }),
  forget: (id: string) =>
    request(CheckInStatus, `/api/checkin/told/${encodeURIComponent(id)}/forget`, {
      method: 'POST',
      body: {},
    }),
};

export const checkInKeys = {
  orders: ['standing-orders'] as const,
  status: ['checkin'] as const,
};

export function useStandingOrders() {
  return useQuery({ queryKey: checkInKeys.orders, queryFn: checkInApi.orders, staleTime: 30_000 });
}

/** How the check-in is doing; looked at again every minute while the page is open. */
export function useCheckIn() {
  return useQuery({
    queryKey: checkInKeys.status,
    queryFn: checkInApi.status,
    refetchInterval: 60_000,
  });
}

const said = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

/** Every change to an order: the list and the check-in follow it. */
export function useOrderChange<T>(
  fn: (arg: T) => Promise<unknown>,
  fallback: string,
  /** `inline`: the caller says the refusal beside the field instead of a toast. */
  { inline = false }: { inline?: boolean } = {},
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void client.invalidateQueries({ queryKey: checkInKeys.orders });
      void client.invalidateQueries({ queryKey: checkInKeys.status });
    },
    onError: (error) => {
      if (!inline) toast.error(said(error, fallback));
    },
  });
}

export function useCheckInChange<T>(fn: (arg: T) => Promise<CheckInStatus>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (status) => client.setQueryData(checkInKeys.status, status),
    onError: (error) => toast.error(said(error, 'Couldn’t change the check-in.')),
  });
}
