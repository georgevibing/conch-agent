import type { Skill, SkillDetail, SkillMode, SkillsList, UpdateSkillBody } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { skillsApi } from './api';

export const skillKeys = {
  all: ['skills'] as const,
  one: (id: string) => ['skills', id] as const,
};

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

/** The quick switch on a card: on keeps "When I ask" if that's what it was. */
export function useToggleSkill() {
  const update = useUpdateSkill();
  return (skill: Skill, on: boolean) => {
    const mode: SkillMode = on ? (skill.mode === 'manual' ? 'manual' : 'auto') : 'off';
    update.mutate({ id: skill.id, patch: { mode } });
  };
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
