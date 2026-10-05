import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectProjects } from './e2e-projects.mjs';

const names = ['ready', 'browser', 'releases', 'channels-mail', 'discover', 'channels'];

test('shards cover every journey once, including browser dependencies and shared release state', () => {
  const shards = Array.from({ length: 4 }, (_, i) => [
    ...selectProjects(names, { shard: `${i + 1}/4` }),
  ]);
  assert.deepEqual(shards.flat().sort(), [...names].sort());
  assert.equal(new Set(shards.flat()).size, names.length);
  assert.ok(shards.every((shard) => shard.length <= 2));
});

test('selecting the browser starts only its gateway', () => {
  assert.deepEqual([...selectProjects(names, { argv: ['--project=browser'] })], ['browser']);
});

test('CLI project lists and environment selection combine, with globs and no duplicates', () => {
  assert.deepEqual(
    [
      ...selectProjects(names, {
        argv: ['--project', 'ready', 'channels*', '--list'],
        only: ' ready, discover ',
      }),
    ],
    ['ready', 'channels-mail', 'discover', 'channels'],
  );
});

test('invalid selectors fail instead of silently running no tests or all gateways', () => {
  for (const shard of [
    '0/4',
    '5/4',
    '1/0',
    'x/y',
    '1.5/4',
    '2',
    '9999999999999999/9999999999999999',
  ])
    assert.throws(() => selectProjects(names, { shard }), /CONCH_E2E_SHARD/);
  assert.throws(() => selectProjects(names, { only: 'typo' }), /Unknown E2E project/);
  assert.throws(() => selectProjects(names, { argv: ['--project'] }), /needs a project name/);
  assert.throws(() => selectProjects(['ready'], { shard: '2/4' }), /No E2E projects/);
});
