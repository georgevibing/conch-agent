import type { WorkedAt, WorkPlaceId, WorkPlaceKind } from '@conch/protocol';

/** One command for a place to run. */
export interface RunRequest {
  command: string;
  /** The chat's work folder on this computer. */
  cwd: string;
  timeoutMs: number;
  /**
   * The command may use the network and change `.git` (the person said yes to
   * leaving the sealed box, or chose Full trust). Otherwise a place that can
   * seal runs it with no network and `.git` read-only, as this computer would.
   */
  open: boolean;
  signal: AbortSignal;
  conversationId: string;
  /** Places that never go anywhere: Passwords, Conch's keys, your sign-ins. */
  forbidden: string[];
}

export interface RunResult {
  code: number | null;
  output: string;
  timedOut: boolean;
  /** Said once after the output, for the model: "2 files came back." */
  note?: string;
}

/**
 * Somewhere a chat's commands run other than this computer's sealed box
 * (ADR 0106). Engines never see which: they hand the command to `run`.
 */
export interface WorkPlace {
  readonly id: WorkPlaceId;
  readonly kind: Exclude<WorkPlaceKind, 'computer'>;
  /** What a command's row says: "a container", "build-box", "the cloud". */
  readonly where: WorkedAt;
  /**
   * It can keep the sealed box's promise for a sealed command (no network,
   * `.git` read-only). When it can't, every command there counts as leaving
   * the box, so the guard and Auto's risk policy judge each one as such.
   */
  readonly seals: boolean;
  /** For the model, in the command tool's description: where commands run and what to expect. */
  readonly about: string;
  run(request: RunRequest): Promise<RunResult>;
}

/** The place isn't there to run commands, in words for the person and the model. */
export class PlaceUnavailable extends Error {
  constructor(
    message: string,
    /** A program it needs (ADR 0016), when that's what's missing. */
    readonly need?: string,
  ) {
    super(message);
  }
}
