import { describe, expect, it } from 'vitest';

import {
  formatValue,
  joinSkill,
  readFlag,
  readKey,
  setKeys,
  splitSkill,
  splitTitle,
} from './frontmatter';

const OPENCLAW = `---
name: gh-triage
description: "Triage GitHub issues: label, dedupe and assign. Use when asked to triage."
metadata: {"openclaw": {"requires": {"bins": ["gh"]}}}
user-invocable: true
---

# GitHub triage

Run \`gh issue list\` in {baseDir}.
`;

const HERMES = `---
name: release-notes
description: >
  Writes release notes from merged pull requests.
  Use when a release is being cut.
version: 1.0.0
author: Ada
license: MIT
metadata:
  hermes:
    tags: [Writing, Git]
    related_skills: [changelog]
---
# Release notes

Steps…
`;

describe('SKILL.md front matter', () => {
  it('reads the keys other agents write — quoted, folded and plain', () => {
    const openclaw = splitSkill(OPENCLAW);
    expect(readKey(openclaw.front, 'name')).toBe('gh-triage');
    expect(readKey(openclaw.front, 'description')).toBe(
      'Triage GitHub issues: label, dedupe and assign. Use when asked to triage.',
    );
    expect(readFlag(openclaw.front, 'user-invocable')).toBe(true);
    // Nested maps and inline JSON aren't scalars.
    expect(readKey(openclaw.front, 'metadata')).toBeUndefined();

    const hermes = splitSkill(HERMES);
    expect(readKey(hermes.front, 'description')).toBe(
      'Writes release notes from merged pull requests. Use when a release is being cut.',
    );
    expect(readKey(hermes.front, 'version')).toBe('1.0.0');
    expect(readKey(hermes.front, 'metadata')).toBeUndefined();
    expect(splitTitle(hermes.body)).toEqual({ title: 'Release notes', instructions: 'Steps…' });
  });

  it('reads single quotes, literal blocks, comments and CRLF files', () => {
    const file = splitSkill(
      "---\r\nname: 'it''s-fine' # a comment\r\ndescription: |\r\n  Line one\r\n  Line two\r\nplain: hello   # trailing\r\n---\r\nBody\r\n",
    );
    expect(readKey(file.front, 'name')).toBe("it's-fine");
    expect(readKey(file.front, 'description')).toBe('Line one\nLine two');
    expect(readKey(file.front, 'plain')).toBe('hello');
    expect(file.body).toBe('Body\n');
  });

  it('decodes double-quoted escapes', () => {
    const { front } = splitSkill('---\ndescription: "Tab\\there, quote \\" and \\u00e9"\n---\n');
    expect(readKey(front, 'description')).toBe('Tab\there, quote " and é');
  });

  it('treats a file without front matter as all body', () => {
    expect(splitSkill('# Just a heading\n\ntext')).toEqual({
      front: undefined,
      body: '# Just a heading\n\ntext',
    });
    expect(splitSkill('---\nname: x\nno end').front).toBeUndefined();
  });

  it('rewrites only the keys Conch owns and keeps everything else exactly', () => {
    const { front, body } = splitSkill(HERMES);
    const next = setKeys(front, [
      ['description', 'Drafts release notes. Use when cutting a release.'],
      ['disable-model-invocation', true],
    ]);
    expect(next).toBe(`name: release-notes
description: Drafts release notes. Use when cutting a release.
version: 1.0.0
author: Ada
license: MIT
metadata:
  hermes:
    tags: [Writing, Git]
    related_skills: [changelog]
disable-model-invocation: true`);
    // And back: removing a key removes only that key.
    expect(setKeys(next, [['disable-model-invocation', undefined]])).not.toContain('disable');
    expect(joinSkill({ front: next, body })).toMatch(
      /^---\nname: release-notes\n[\s\S]*\n---\n\n# Release notes\n\nSteps…\n$/,
    );
  });

  it('puts new keys where people expect them', () => {
    expect(
      setKeys(undefined, [
        ['description', 'Does a thing.'],
        ['name', 'a-thing'],
      ]),
    ).toBe('name: a-thing\ndescription: Does a thing.');
    expect(
      setKeys('license: MIT', [
        ['name', 'x'],
        ['description', 'y'],
      ]),
    ).toBe('name: x\ndescription: y\nlicense: MIT');
  });

  it('quotes only when YAML would misread the value', () => {
    expect(formatValue('Drafts notes. Use when asked.')).toBe('Drafts notes. Use when asked.');
    expect(formatValue('Label: dedupe')).toBe('"Label: dedupe"');
    expect(formatValue('true')).toBe('"true"');
    expect(formatValue('# not a comment')).toBe('"# not a comment"');
    expect(formatValue('- a list?')).toBe('"- a list?"');
    expect(formatValue(true)).toBe('true');
    // Whatever we write, we read back the same.
    for (const value of ['a: b', 'it’s "quoted"', "o'clock", '1.0', 'back\\slash', 'x #y']) {
      const front = setKeys(undefined, [['description', value]]);
      expect(readKey(front, 'description')).toBe(value);
    }
  });
});
