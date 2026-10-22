import type { Attachment } from '@conch/protocol';

import type { EngineAttachments, TurnImage } from '../../engines/types';

/**
 * What one turn's engine can do with what was attached. `files`: its own
 * tools open a file by path (Claude Code, Codex, ACP agents). `tools`: it can
 * call Conch's `read_document` and `read_file`, which take an attachment by
 * id. An HTTP API model has Conch's tools (natively or in words, ADR 0072)
 * but no file system of its own, so it's `tools` without `files`.
 */
export interface AttachmentAbilities extends EngineAttachments {
  tools?: boolean;
}

/**
 * What readers may lean on. Every field is optional: a reader whose helper
 * isn't here (no whisper.cpp, no ffmpeg) returns a plain note instead.
 * A reader that needs another helper adds its own optional field here.
 */
export interface ReaderDeps {
  /** Placeholder so the interface is never empty; readers add their own fields. */
  readonly home?: string;
}

export interface ReaderInput {
  attachment: Attachment;
  /** The file as uploaded. */
  bytes: Buffer;
  /** Where it is on this computer (never shown to a model that can't open files). */
  path: string;
  /** Most characters of text this attachment may add to the message. */
  room: number;
  can: AttachmentAbilities;
  deps: ReaderDeps;
  signal: AbortSignal;
}

export interface ReaderResult {
  /**
   * One plain sentence on what this is and how it was read, shown before the
   * text: "(A ZIP archive of 14 files. Its text files are below.)"
   */
  note: string;
  /** Words the model reads, fenced inside the attachment. At most `room` characters. */
  text?: string;
  /** Pictures for engines that see (a video's frames, a scanned page). Fitted for models. */
  images?: TurnImage[];
  /** There's more than fits: said with how to get the rest. */
  more?: boolean;
}

/**
 * Turns one family of files into something every model can use (ADR 0017).
 * Readers run in order; the first whose `matches` says yes reads it. One that
 * returns undefined lets the next try, and the plain note stands at the end.
 */
export interface Reader {
  readonly id: string;
  matches(attachment: Attachment, head: Buffer): boolean;
  /**
   * Also for engines that open files themselves. Off for what they read well on
   * their own (Claude Code opens a PDF); on for what they can't (hearing audio).
   */
  readonly everywhere?: boolean;
  read(input: ReaderInput): Promise<ReaderResult | undefined>;
}
