import { describe, expect, it } from 'vitest';

import { CLI_COMMANDS, DEVICES_SUBCOMMANDS, SKILLS_SUBCOMMANDS } from './cliCommands';
import { Env, ENV_ABOUT } from './config';

// `pnpm conch help` and the documentation's reference are both drawn from
// these, so a command or a setting with no words would show as a blank.
describe('the words for pnpm conch', () => {
  it('every command says what it does, in a line and in a sentence or two', () => {
    for (const command of CLI_COMMANDS) {
      expect(command.usage.startsWith(command.name), command.usage).toBe(true);
      expect(command.summary.length, command.usage).toBeGreaterThan(8);
      expect(command.detail.length, command.usage).toBeGreaterThan(40);
      // The line is for a terminal; the sentence is for a page.
      expect(command.detail, command.usage).toMatch(/\.$/);
    }
  });

  it('lists each way of typing a command once', () => {
    const usages = CLI_COMMANDS.map((command) => command.usage);
    expect(new Set(usages).size).toBe(usages.length);
  });

  it('carries the subcommands that `devices help` and `skills help` print', () => {
    const subcommands = (name: string) =>
      CLI_COMMANDS.find((command) => command.name === name && 'subcommands' in command);
    expect(subcommands('devices')).toMatchObject({ subcommands: DEVICES_SUBCOMMANDS });
    expect(subcommands('skills')).toMatchObject({ subcommands: SKILLS_SUBCOMMANDS });
    for (const sub of [...DEVICES_SUBCOMMANDS, ...SKILLS_SUBCOMMANDS])
      expect(sub.summary.length, sub.usage).toBeGreaterThan(8);
  });
});

describe('the words for the environment', () => {
  it('describes exactly the variables Conch reads', () => {
    expect(Object.keys(ENV_ABOUT).sort()).toEqual(Object.keys(Env.shape).sort());
    for (const [name, about] of Object.entries(ENV_ABOUT))
      expect(about.about.length, name).toBeGreaterThan(20);
  });

  it('says what happens when a variable with no default is left unset', () => {
    const parsed = Env.parse({});
    for (const [name, about] of Object.entries(ENV_ABOUT)) {
      const hasDefault = parsed[name as keyof typeof parsed] !== undefined;
      if (!hasDefault)
        expect(about.unset, `${name} has no default: say what unset means`).toBeTruthy();
    }
  });
});
