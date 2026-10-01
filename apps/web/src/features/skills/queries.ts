import type { Skill, SkillDetail, SkillsList, UpdateSkillBody } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { skillsApi } from './api';

export const skillKeys = {
  all: ['skills'] as const,
  one: (id: string) => ['skills', id] as const,
  publishers: ['skill-publishers'] as const,
};

/** Whose signed skills you trust (ADR 0031). */
export function usePublishers() {
  return useQuery({
    queryKey: skillKeys.publishers,
    queryFn: async () => (await skillsApi.publishers()).publishers,
  });
}

export function useForgetPublisher() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (fingerprint: string) => skillsApi.forgetPublisher(fingerprint),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: skillKeys.publishers });
      // What's verified is worked out again.
      void client.invalidateQueries({ queryKey: skillKeys.all });
    },
    onError: (error) => toast.error(errorText(error, 'Couldn’t forget that publisher.')),
  });
}

/** After trusting a publisher: the skill as it is now, and everything else signed by them. */
export function trustedPublisher(client: QueryClient, skill: SkillDetail) {
  putSkill(client, skill);
  void client.invalidateQueries({ queryKey: skillKeys.publishers });
  void client.invalidateQueries({ queryKey: skillKeys.all });
}

/** Every skill: Conch's own, and those found in other agents' folders. */
export function useSkills() {
  return useQuery({ queryKey: skillKeys.all, queryFn: () => skillsApi.list(), staleTime: 30_000 });
}

export function useSkill(id: string | undefined) {
  return useQuery({
    queryKey: skillKeys.one(id ?? ''),
    queryFn: () => skillsApi.get(id ?? ''),
    enabled: Boolean(id),
    retry: false,
  });
}

/** Skills that can be asked for by name right now (not off, not broken). */
export function usableSkills(list: SkillsList | undefined): Skill[] {
  return (list?.skills ?? []).filter((s) => s.mode !== 'off' && !s.problem);
}

function putSkill(client: QueryClient, skill: SkillDetail, previousId?: string) {
  client.setQueryData(skillKeys.one(skill.id), skill);
  client.setQueryData<SkillsList>(skillKeys.all, (list) => {
    if (!list) return list;
    const { instructions: _instructions, ...summary } = skill;
    const others = list.skills.filter((s) => s.id !== skill.id && s.id !== previousId);
    return { ...list, skills: [summary, ...others] };
  });
  void client.invalidateQueries({ queryKey: skillKeys.all });
}

export function useCreateSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: skillsApi.create,
    onSuccess: (skill) => putSkill(client, skill),
  });
}

export function useUpdateSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSkillBody }) =>
      skillsApi.update(id, patch),
    onSuccess: (skill, { id }) => putSkill(client, skill, id),
    onError: (error) => toast.error(errorText(error, 'Couldn’t save that change.')),
  });
}

export function useRemoveSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillsApi.remove(id),
    onSuccess: (_, id) => {
      client.setQueryData<SkillsList>(skillKeys.all, (list) =>
        list ? { ...list, skills: list.skills.filter((s) => s.id !== id) } : list,
      );
      client.removeQueries({ queryKey: skillKeys.one(id) });
    },
    onError: (error) => toast.error(errorText(error, 'Couldn’t remove that skill.')),
  });
}

export function useCopySkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillsApi.copy(id),
    onSuccess: (skill) => putSkill(client, skill),
    onError: (error) => toast.error(errorText(error, 'Couldn’t copy that skill.')),
  });
}

export function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message ? error.message : fallback;
}
