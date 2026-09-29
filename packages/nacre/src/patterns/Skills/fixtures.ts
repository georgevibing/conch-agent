/* Story/test fixtures — not exported from the package. */
import type { SkillCardProps } from './SkillCard';

type Fixture = Pick<
  SkillCardProps,
  'name' | 'title' | 'description' | 'mode' | 'source' | 'loadedBy' | 'problem'
>;

export const skills: Fixture[] = [
  {
    name: 'weekly-review',
    title: 'Weekly review',
    description:
      'Drafts a weekly review from your calendar and notes. Use when asked to review or plan the week.',
    mode: 'auto',
  },
  {
    name: 'release-notes',
    title: 'Release notes',
    description: 'Writes release notes from merged pull requests. Use when a release is being cut.',
    mode: 'manual',
  },
  {
    name: 'write-like-me',
    title: 'Write like me',
    description:
      'Rewrites a draft in your voice: short sentences, no jargon. Use when polishing an email or post.',
    mode: 'auto',
  },
  {
    name: 'gh-triage',
    title: 'GitHub triage',
    description: 'Labels, dedupes and assigns new issues. Use when asked to triage a repository.',
    mode: 'off',
    source: 'OpenClaw',
  },
  {
    name: 'pdf',
    title: 'PDF',
    description: 'Extracts text and tables from PDFs and fills forms. Use when working with PDFs.',
    mode: 'off',
    source: 'Claude Code',
    loadedBy: 'Claude Code',
  },
  {
    name: 'broken',
    title: 'Broken',
    description: '',
    mode: 'off',
    source: 'Shared agent skills',
    problem: 'Its SKILL.md has no front matter (the --- block with a name and description).',
  },
];
