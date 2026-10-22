/**
 * Recordings and videos, for every model (ADR 0017). No provider Conch drives
 * hears a recording or watches a video it's given as a file, so Conch does it
 * here, on this computer, and nothing goes to anyone new:
 *
 * - **What's said** in it is heard with whisper.cpp, the same as a voice note
 *   (ADR 0077), ten minutes at a time, up to its first hour, each part marked
 *   with the time it starts.
 * - **How long** it is, its size and its title come from FFprobe (or FFmpeg's
 *   own report of it, when FFprobe isn't beside it).
 * - **What a video shows**: up to eight pictures from it, evenly spaced and
 *   fitted for models (`fit.ts`), go to engines that see, with their times.
 *
 * What it made is kept beside the attachment (`.for-models-media.json` and
 * `.for-models-frame-N.jpg`), so a chat that carries on never hears it again.
 * A long recording keeps being heard after the turn moves on; the next
 * message has the rest.
 *
 * The file is untrusted. FFmpeg is told the container Conch found in its first
 * bytes (`-f`), may open only real media containers (`-format_whitelist`)
 * and only plain files (`-protocol_whitelist file`), never reads stdin, and
 * is given the path as an argument, never through a shell.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Attachment } from '@conch/protocol';

import type { TurnImage } from '../../engines/types';
import { run } from '../../lib/proc';
import {
  AUDIO_DEMUXERS,
  pipeThrough,
  sized,
  sniffAudio,
  wavSeconds,
  type Exec,
  type Pipe,
} from '../../voice/audio';
import type { Hearing } from '../../voice/service';
import { fitPicture } from '../fit';
import type { Reader, ReaderResult } from './types';

/** What hearing and watching need (`services.ts` wires the voice service's). */
export interface MediaDeps {
  /** FFmpeg, where it is (the `ffmpeg` need). */
  ffmpeg: () => Promise<string | undefined>;
  /** FFprobe, where it is; by default the one beside FFmpeg. */
  ffprobe?: () => Promise<string | undefined>;
  /** Whether whisper.cpp and its model are here (`VoiceService.hearing`). */
  hearing: () => Promise<Hearing>;
  /** The words in a 16 kHz mono WAV of at most `maxBytes` (`VoiceService.transcribe`). */
  transcribe: (wav: Uint8Array, maxBytes: number) => Promise<string>;
  /** Tests stand in for these. */
  exec?: Exec;
  pipe?: Pipe;
}

/** Heard this much at a time: what a voice note may be (`VOICE_NOTE_SECONDS`). */
export const CHUNK_SECONDS = 600;
/** Heard up to this much of one recording. */
export const HEARD_MAX_SECONDS = 3600;
/** At most this many pictures from one video. */
export const MAX_FRAMES = 8;
/** How long a turn waits for hearing before it goes with what's done. */
const WAIT_MS = 90_000;
/** Longest a recording is listened to, turn or no turn. */
const JOB_MS = 30 * 60_000;
const CACHE = '.for-models-media.json';
const frameFile = (i: number) => `.for-models-frame-${i + 1}.jpg`;
const CHUNK_BYTES = 32_000 * CHUNK_SECONDS + 4096;

const DEMUXERS = [...AUDIO_DEMUXERS, 'avi'] as const;
type Demuxer = (typeof DEMUXERS)[number];

const AUDIO_EXT = new Set([
  'mp3',
  'm4a',
  'aac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'flac',
  'amr',
  'caf',
  'weba',
  'mka',
]);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', '3gp']);

/** The container a recording or video really is, from its first bytes. */
export function sniffMedia(head: Uint8Array): Demuxer | undefined {
  const b = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  if (
    b.length >= 12 &&
    b.toString('latin1', 0, 4) === 'RIFF' &&
    b.toString('latin1', 8, 12) === 'AVI '
  )
    return 'avi';
  return sniffAudio(head);
}

function ext(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export interface Probe {
  seconds?: number;
  video?: { width: number; height: number };
  audio: boolean;
  tags: { title?: string; artist?: string; album?: string; date?: string };
}

interface Frame {
  at: number;
  file: string;
}

/** What's kept beside the attachment. */
interface Kept {
  v: 1;
  size: number;
  probe?: Probe;
  frames?: Frame[];
  /** What's said, one entry per `CHUNK_SECONDS`. */
  chunks: string[];
  /** Heard to its end (or to `HEARD_MAX_SECONDS`). */
  heard?: boolean;
  /** It went on past `HEARD_MAX_SECONDS`. */
  capped?: boolean;
}

interface Job {
  kept: Kept;
  hearing?: Hearing;
  /** Something went wrong hearing it; it's tried again next time. */
  problem?: boolean;
  done: Promise<void>;
}

/** One listen per file at a time, shared by every turn that asks. */
const jobs = new Map<string, Job>();

/** FFmpeg runs one at a time for recordings and videos; whisper.cpp has its own queue. */
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

const QUIET = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
/** The input, sealed: its own container, only real media containers, only plain files. */
const input = (path: string, demuxer: Demuxer, from?: number, length?: number) => [
  '-protocol_whitelist',
  'file',
  '-format_whitelist',
  DEMUXERS.join(','),
  '-probesize',
  '5000000',
  '-f',
  demuxer,
  ...(from ? ['-ss', from.toFixed(2)] : []),
  ...(length ? ['-t', String(length)] : []),
  '-i',
  `file:${path}`,
];

/** Untrusted words from a file's tags: one line, no control characters, short. */
function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    // eslint-disable-next-line no-control-regex -- control characters are exactly what's removed
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 200) : undefined;
}

function tagsOf(raw: Record<string, unknown> | undefined): Probe['tags'] {
  const lower = Object.fromEntries(
    Object.entries(raw ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const tags: Probe['tags'] = {};
  for (const key of ['title', 'artist', 'album', 'date'] as const) {
    const value = clean(lower[key]);
    if (value) tags[key] = value;
  }
  return tags;
}

/** What FFprobe says, as JSON. */
export function parseProbe(json: string): Probe | undefined {
  try {
    const data = JSON.parse(json) as {
      format?: { duration?: string; tags?: Record<string, unknown> };
      streams?: {
        codec_type?: string;
        width?: number;
        height?: number;
        disposition?: { attached_pic?: number };
        tags?: Record<string, unknown>;
      }[];
    };
    const streams = data.streams ?? [];
    const video = streams.find(
      (s) => s.codec_type === 'video' && !s.disposition?.attached_pic && s.width && s.height,
    );
    const seconds = Number(data.format?.duration);
    return {
      ...(Number.isFinite(seconds) && seconds > 0 && { seconds }),
      ...(video?.width && video.height && { video: { width: video.width, height: video.height } }),
      audio: streams.some((s) => s.codec_type === 'audio'),
      tags: tagsOf({
        ...streams.find((s) => s.codec_type === 'audio')?.tags,
        ...data.format?.tags,
      }),
    };
  } catch {
    return undefined;
  }
}

/** What FFmpeg says of its input when given no output (no FFprobe here). */
export function parseFfmpegInfo(stderr: string): Probe | undefined {
  const duration = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(stderr);
  const video = /Stream #[^\n]*: Video: (?![^\n]*attached pic)[^\n]*?(\d{2,5})x(\d{2,5})/.exec(
    stderr,
  );
  const audio = /Stream #[^\n]*: Audio: /.test(stderr);
  if (!duration && !video && !audio) return undefined;
  const raw: Record<string, string> = {};
  for (const match of stderr.matchAll(/^\s{4}(title|artist|album|date)\s*: (.*)$/gim)) {
    const key = (match[1] ?? '').toLowerCase();
    if (!(key in raw)) raw[key] = match[2] ?? '';
  }
  const seconds = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : 0;
  return {
    ...(seconds > 0 && { seconds }),
    ...(video && { video: { width: Number(video[1]), height: Number(video[2]) } }),
    audio,
    tags: tagsOf(raw),
  };
}

async function probe(
  media: MediaDeps,
  ffmpeg: string,
  path: string,
  demuxer: Demuxer,
): Promise<Probe | undefined> {
  const exec: Exec =
    media.exec ??
    ((file, args, timeout) => run(file, args, { timeout, maxBuffer: 2 * 1024 * 1024 }));
  const beside = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  const ffprobe = media.ffprobe
    ? await media.ffprobe().catch(() => undefined)
    : existsSync(beside)
      ? beside
      : undefined;
  if (ffprobe) {
    const result = await exec(
      ffprobe,
      ['-v', 'error', ...input(path, demuxer), '-show_format', '-show_streams', '-of', 'json'],
      30_000,
    );
    const found = result.code === 0 ? parseProbe(result.stdout) : undefined;
    if (found) return found;
  }
  // FFmpeg with no output says what it read, then that it has nowhere to put it.
  const result = await exec(ffmpeg, ['-nostdin', '-hide_banner', ...input(path, demuxer)], 30_000);
  return parseFfmpegInfo(result.stderr);
}

/** Where the pictures are taken: evenly spaced, one per ten seconds, at most eight. */
export function frameTimes(seconds: number | undefined): number[] {
  if (!seconds) return [0];
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.ceil(seconds / 10)));
  return Array.from(
    { length: count },
    (_, i) => Math.round(((i + 0.5) * seconds * 10) / count) / 10,
  );
}

async function grabFrames(
  media: MediaDeps,
  ffmpeg: string,
  path: string,
  demuxer: Demuxer,
  seconds: number | undefined,
): Promise<Frame[]> {
  const frames: Frame[] = [];
  const times = frameTimes(seconds);
  for (const [i, at] of times.entries()) {
    const result = await inTurn(() =>
      (media.pipe ?? pipeThrough)(
        ffmpeg,
        [
          ...QUIET,
          ...input(path, demuxer, at),
          '-frames:v',
          '1',
          '-an',
          '-vf',
          "scale='min(1280,iw)':-2",
          '-map_metadata',
          '-1',
          '-f',
          'image2pipe',
          '-c:v',
          'mjpeg',
          '-q:v',
          '4',
          'pipe:1',
        ],
        Buffer.alloc(0),
        { timeout: 60_000, maxOut: 8 * 1024 * 1024 },
      ),
    );
    if (result.code !== 0 || !result.stdout.length) continue;
    const fitted = await fitPicture(result.stdout, 'image/jpeg');
    const file = frameFile(i);
    const saved = await writeFile(join(dirname(path), file), fitted.bytes, { mode: 0o600 }).then(
      () => true,
      () => false,
    );
    if (saved) frames.push({ at, file });
  }
  return frames;
}

/** The 16 kHz WAV whisper.cpp reads, of `CHUNK_SECONDS` from `from`. */
async function chunkWav(
  media: MediaDeps,
  ffmpeg: string,
  path: string,
  demuxer: Demuxer,
  from: number,
): Promise<Buffer | undefined> {
  const result = await inTurn(() =>
    (media.pipe ?? pipeThrough)(
      ffmpeg,
      [
        ...QUIET,
        ...input(path, demuxer, from, CHUNK_SECONDS),
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        '-map_metadata',
        '-1',
        '-fflags',
        '+bitexact',
        '-f',
        'wav',
        'pipe:1',
      ],
      Buffer.alloc(0),
      { timeout: 120_000, maxOut: CHUNK_BYTES },
    ),
  );
  return result.code === 0 && result.stdout.length > 44 ? sized(result.stdout) : undefined;
}

async function keep(path: string, kept: Kept): Promise<void> {
  // The attachment may have gone meanwhile (its chat deleted): then nothing is kept.
  await writeFile(join(dirname(path), CACHE), JSON.stringify(kept), { mode: 0o600 }).catch(
    () => undefined,
  );
}

async function kept(path: string, size: number): Promise<Kept | undefined> {
  const raw = await readFile(join(dirname(path), CACHE), 'utf8').catch(() => undefined);
  if (!raw) return undefined;
  try {
    const found = JSON.parse(raw) as Kept;
    return found.v === 1 && found.size === size && Array.isArray(found.chunks) ? found : undefined;
  } catch {
    return undefined;
  }
}

async function listen(
  job: Job,
  media: MediaDeps,
  ffmpeg: string,
  path: string,
  demuxer: Demuxer,
): Promise<void> {
  const stop = AbortSignal.timeout(JOB_MS);
  const k = job.kept;
  if (!k.probe) {
    const found = await probe(media, ffmpeg, path, demuxer).catch(() => undefined);
    if (!found) return;
    k.probe = found;
    await keep(path, k);
  }
  const probed = k.probe;
  if (probed.video && !k.frames?.every((f) => existsSync(join(dirname(path), f.file)))) {
    k.frames = await grabFrames(media, ffmpeg, path, demuxer, probed.seconds);
    await keep(path, k);
  }
  if (k.heard) return;
  if (!probed.audio) {
    k.heard = true;
    await keep(path, k);
    return;
  }
  job.hearing = await media.hearing().catch(() => ({ ready: false, need: 'whisper' }) as const);
  if (!job.hearing.ready) return;
  while (!stop.aborted) {
    const from = k.chunks.length * CHUNK_SECONDS;
    if (from >= HEARD_MAX_SECONDS) {
      k.heard = true;
      k.capped = !probed.seconds || probed.seconds > HEARD_MAX_SECONDS + 1;
      break;
    }
    if (probed.seconds !== undefined && from >= probed.seconds) {
      k.heard = true;
      break;
    }
    const wav = await chunkWav(media, ffmpeg, path, demuxer, from);
    const seconds = wav ? wavSeconds(wav) : 0;
    if (!wav || seconds < 0.5) {
      // Past its end, or nothing FFmpeg could read: what's heard is all there is.
      if (!wav && !k.chunks.length) job.problem = true;
      else k.heard = true;
      break;
    }
    const text = await media.transcribe(wav, CHUNK_BYTES).catch(() => undefined);
    if (text === undefined) {
      job.problem = true;
      break;
    }
    k.chunks.push(text);
    if (seconds < CHUNK_SECONDS - 1) k.heard = true;
    await keep(path, k);
    if (k.heard) break;
  }
  await keep(path, k);
}

function start(
  path: string,
  size: number,
  found: Kept | undefined,
  media: MediaDeps,
  ffmpeg: string,
  demuxer: Demuxer,
): Job {
  const running = jobs.get(path);
  if (running) return running;
  const job: Job = {
    kept: found ?? { v: 1, size, chunks: [] },
    done: Promise.resolve(),
  };
  job.done = listen(job, media, ffmpeg, path, demuxer)
    .catch(() => {
      job.problem = true;
    })
    .finally(() => jobs.delete(path));
  jobs.set(path, job);
  return job;
}

/** 0:05, 12:30, 1:02:03. */
export function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 45 s, 3 min 12 s, 1 h 4 min. */
function length(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  const m = Math.floor((s % 3600) / 60);
  return `${Math.floor(s / 3600)} h${m ? ` ${m} min` : ''}`;
}

/** Why its words aren't here, and where to get what's missing. */
function unheard(hearing: Hearing | undefined): string {
  if (!hearing || hearing.ready) return '';
  if ('need' in hearing)
    return hearing.need === 'ffmpeg'
      ? " What's said in it isn't here: hearing it needs FFmpeg, which Conch can get in Settings → Voice."
      : " What's said in it isn't here: hearing it on this computer needs whisper.cpp, which Conch can get in Settings → Voice.";
  return hearing.model === 'downloading'
    ? " What's said in it isn't here yet: Conch is getting its speech model, so it can be heard in a few minutes."
    : " What's said in it isn't here: hearing it on this computer needs the speech model (about 150 MB), which Conch can get in Settings → Voice.";
}

async function describe(
  job: Job,
  path: string,
  attachment: Attachment,
  room: number,
  images: boolean,
): Promise<ReaderResult | undefined> {
  const k = job.kept;
  const p = k.probe;
  if (!p)
    return {
      note: "(A recording or video Conch couldn't open: it may be damaged, or in a form FFmpeg doesn't read. If the message depends on it, say so and ask for it in another format.)",
    };
  const video = Boolean(p.video);
  const facts = [
    p.seconds ? `${length(p.seconds)} long` : '',
    p.video ? `${p.video.width}×${p.video.height}` : '',
  ].filter(Boolean);
  let note = `(A ${video ? 'video' : 'recording'}${facts.length ? `, ${facts.join(', ')}` : ''}.`;

  const pictures: TurnImage[] = [];
  if (video && images) {
    for (const frame of k.frames ?? []) {
      const bytes = await readFile(join(dirname(path), frame.file)).catch(() => undefined);
      if (!bytes) continue;
      pictures.push({
        name: `${attachment.name} at ${clock(frame.at)}`,
        mimeType: 'image/jpeg',
        data: bytes.toString('base64'),
        path: join(dirname(path), frame.file),
      });
    }
    if (pictures.length)
      note += ` ${pictures.length === 1 ? 'A picture' : `${pictures.length} pictures`} from it ${pictures.length === 1 ? 'is' : 'are'} shown to you, taken at the times listed below.`;
  } else if (video) note += " This model can't see, so its pictures aren't here.";

  const lines: string[] = [];
  const { title, artist, album, date } = p.tags;
  if (title) lines.push(`Title: ${title}`);
  if (artist) lines.push(`Artist: ${artist}`);
  if (album) lines.push(`Album: ${album}`);
  if (date) lines.push(`Date: ${date}`);
  if (pictures.length)
    lines.push(
      `Pictures taken at: ${(k.frames ?? [])
        .filter((f) => pictures.some((pic) => pic.path === join(dirname(path), f.file)))
        .map((f) => clock(f.at))
        .join(', ')}`,
    );

  let more = false;
  if (!p.audio) note += ' It has no sound.';
  else if (k.chunks.length || k.heard) {
    if (k.chunks.some((c) => c.trim())) {
      note +=
        " What's said in it, heard on this computer, is below, each part marked with the time it starts.";
      lines.push('', 'What is said:');
      k.chunks.forEach((said, i) => {
        if (said.trim()) lines.push(`[${clock(i * CHUNK_SECONDS)}] ${said.trim()}`);
      });
    } else if (k.heard)
      note += ' Nothing is said in it that Conch could hear: it may be music or quiet.';
    if (!k.heard) {
      more = true;
      note += job.problem
        ? ` Only its first ${length(k.chunks.length * CHUNK_SECONDS)} could be heard.`
        : ' Conch is still listening to the rest on this computer: it will be here with the next message.';
    } else if (k.capped) {
      more = true;
      note += ` Only its first ${length(HEARD_MAX_SECONDS)} was heard.`;
    }
  } else if (job.hearing && !job.hearing.ready) note += unheard(job.hearing);
  else if (job.problem) note += " What's said in it couldn't be heard.";
  else {
    more = true;
    note +=
      ' Conch is listening to it on this computer: what it says will be here with the next message.';
  }

  let text = lines.join('\n').trim();
  if (text.length > room) {
    text = text.slice(0, room);
    more = true;
    note += ' Only the start fits here.';
  }
  const missing = more || (p.audio && !k.heard && !k.chunks.length);
  return {
    note: `${note}${missing ? " If the message depends on what isn't here, say so." : ''})`,
    ...(text && { text }),
    ...(pictures.length && { images: pictures }),
    ...(more && { more }),
  };
}

function wait(job: Job, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, WAIT_MS);
    timer.unref?.();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    signal.addEventListener('abort', done, { once: true });
    void job.done.then(done);
  });
}

/**
 * Recordings and videos (mp3, m4a, wav, ogg, opus, flac, amr, webm, mp4, mov,
 * mkv, avi): what's said in them, heard here, and a video's pictures. For
 * every engine: none of them hears or watches a file by itself.
 */
export const media: Reader = {
  id: 'media',
  everywhere: true,
  matches: (attachment, head) =>
    attachment.kind === 'file' &&
    (attachment.mimeType.startsWith('audio/') ||
      attachment.mimeType.startsWith('video/') ||
      AUDIO_EXT.has(ext(attachment.name)) ||
      VIDEO_EXT.has(ext(attachment.name))) &&
    sniffMedia(head) !== undefined,
  async read({ attachment, bytes, path, room, can, deps, signal }) {
    const demuxer = sniffMedia(bytes.subarray(0, 4096));
    if (!demuxer) return undefined;
    const tools = deps.media;
    const ffmpeg = tools ? await tools.ffmpeg().catch(() => undefined) : undefined;
    if (!tools || !ffmpeg)
      return {
        note: "(A recording or video. Conch hears and watches these on this computer with FFmpeg, which isn't here yet: Conch can get it in Settings → Voice. Until then what's in it isn't here; if the message depends on it, say so and point the person there.)",
      };
    const job = start(path, bytes.length, await kept(path, bytes.length), tools, ffmpeg, demuxer);
    await wait(job, signal);
    return describe(job, path, attachment, room, can.images === true);
  },
};

/** For tests: forget listens in progress. */
export function forgetJobs(): void {
  jobs.clear();
}
