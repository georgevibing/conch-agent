/**
 * `conch background [on|off|status]` and `conch quit`: Always on from the
 * terminal (ADR 0026), for the computer Conch runs on — a Mac mini in a
 * cupboard, a server you reach over SSH.
 */
import { working } from '../cli/pearl';
import type { Ui } from '../cli/ui';
import type { BackgroundService } from './service';

export interface BackgroundIo {
  /** Everything a person reads goes through the terminal kit. */
  ui: Ui;
  /** What to tell people to type: `conch quit` (or `pnpm conch quit` in a checkout). */
  conch: (args: string) => string;
  /** The gateway recorded as running: its pid and whether the computer started it. */
  running: () => Promise<{ pid: number; port: number; background?: boolean } | undefined>;
  /** Conch answers at its address. */
  answering: () => Promise<boolean>;
  /** The address people open. */
  url: () => Promise<string>;
  /** The last thing Conch said in its log. */
  lastWords: () => Promise<string | undefined>;
  kill: (pid: number) => void;
  sleep: (ms: number) => Promise<void>;
  /** How long to wait for a background Conch to answer. */
  waitMs?: number;
}

/** Conch didn't answer in time: the words say what happened, the caller says what next. */
class NoAnswer extends Error {}

export async function backgroundCommand(
  args: string[],
  service: BackgroundService,
  io: BackgroundIo,
): Promise<number> {
  const { ui, conch } = io;
  const verb = args[0] ?? 'status';
  const status = await service.status();

  if (verb === 'status') {
    ui.say(ui.bold('Always on'));
    ui.blank();
    if (!status.supported) {
      ui.hint(status.unsupported ?? 'Always on isn’t available here.');
      return 0;
    }
    ui.say(
      status.on
        ? `${ui.success(ui.sym.dot)} On: Conch starts by itself when you log in.`
        : `${ui.dim(ui.sym.ring)} Off: Conch runs while its window is open.`,
    );
    const running = await io.running();
    if (running)
      ui.hint(
        running.background ? '  Running in the background now. 🐚' : '  Running in a window now.',
      );
    if (status.problem) {
      ui.note(status.problem.message);
      if (status.problem.command) ui.command(status.problem.command);
    }
    if (status.place) ui.hint(`  You’ll find it in ${status.place}.`);
    ui.blank();
    ui.hint(
      status.on
        ? `Turn it off: ${ui.code(conch('background off'))} · Stop Conch now: ${ui.code(conch('quit'))}`
        : `Turn it on: ${ui.code(conch('background on'))}`,
    );
    return 0;
  }

  if (verb === 'on') {
    if (!status.supported) {
      ui.error(status.unsupported ?? 'Always on isn’t available here.');
      return 1;
    }
    try {
      await service.enable();
    } catch (error) {
      ui.error((error as Error).message);
      return 1;
    }
    const running = await io.running();
    if (running && !running.background) {
      ui.ok('Always on is on.');
      ui.hint('Conch is open in a window right now. Close that window (or press Ctrl+C in it),');
      ui.hint('and Conch carries on in the background by itself.');
      return 0;
    }
    try {
      await working(
        ui,
        'Moving Conch to the background',
        async () => {
          const deadline = Date.now() + (io.waitMs ?? 30_000);
          while (Date.now() < deadline && !(await io.answering())) await io.sleep(500);
          if (!(await io.answering())) throw new NoAnswer('Conch didn’t start just now.');
          return io.url();
        },
        { done: (url) => `Conch is running in the background at ${ui.bold(url)} ✨` },
      );
      ui.hint(`It starts by itself when you log in. To stop it: ${ui.code(conch('quit'))}`);
      return 0;
    } catch (error) {
      if (!(error instanceof NoAnswer)) throw error;
      const said = await io.lastWords();
      ui.note('It will start when you log in, though.');
      if (said) ui.hint(`  It said: ${said}`);
      return 1;
    }
  }

  if (verb === 'off') {
    const result = await service.set(false);
    ui.ok('Always on is off: Conch won’t start by itself when you log in.');
    if (result.status.running === 'background' || (await io.running())?.background)
      ui.hint(`Conch keeps running until you quit it: ${ui.code(conch('quit'))}`);
    return 0;
  }

  ui.error(`Hmm, “background ${verb}” isn’t a thing.`);
  ui.hint(
    `Try ${ui.code(conch('background on'))}, ${ui.code(conch('background off'))} or ${ui.code(conch('background'))}.`,
  );
  return 1;
}

/** `conch quit`: stop the Conch that's running, wherever it was started. */
export async function quitCommand(io: BackgroundIo): Promise<number> {
  const { ui } = io;
  const running = await io.running();
  if (!running) {
    ui.hint('Conch isn’t running. Nothing to stop.');
    return 0;
  }
  io.kill(running.pid);
  try {
    await working(
      ui,
      'Stopping Conch',
      async () => {
        for (let i = 0; i < 20 && (await io.running()); i++) await io.sleep(250);
        if (await io.running()) throw new NoAnswer('Conch is still stopping. Give it a moment.');
      },
      { done: 'Conch has stopped. Sleep well, little pearl. 🐚' },
    );
  } catch (error) {
    if (!(error instanceof NoAnswer)) throw error;
    return 1;
  }
  if (running.background) ui.hint('It starts again when you log in, or when you open it.');
  return 0;
}
