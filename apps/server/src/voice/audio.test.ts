import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { findExecutable } from '../lib/proc';
import {
  AudioError,
  AUDIO_DEMUXERS,
  MAX_NOTE_BYTES,
  type Pipe,
  pipeThrough,
  sized,
  sniffAudio,
  toVoiceNote,
  toWav16k,
  wavSeconds,
} from './audio';

const b = (text: string, pad = 32) =>
  Buffer.concat([Buffer.from(text, 'latin1'), Buffer.alloc(pad)]);

/** FFmpeg, pretending: records what it was asked, answers with a WAV. */
function fakePipe() {
  const calls: string[][] = [];
  const pipe = vi.fn<Pipe>(async (_file, args) => {
    calls.push(args);
    const wav = Buffer.alloc(44 + 3200);
    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(0xffffffff, 4);
    wav.write('WAVEfmt ', 8, 'ascii');
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16_000, 24);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii');
    wav.writeUInt32LE(0xffffffff, 40);
    return { code: 0, stdout: wav, stderr: '' };
  });
  return { pipe, calls };
}

describe('what a voice note really is', () => {
  it('knows each audio container by its first bytes, whatever it’s called', () => {
    expect(sniffAudio(b('OggS'))).toBe('ogg');
    expect(sniffAudio(b('RIFF\0\0\0\0WAVE'))).toBe('wav');
    expect(sniffAudio(b('\0\0\0\x20ftypM4A '))).toBe('mov');
    expect(sniffAudio(b('caff'))).toBe('caf');
    expect(sniffAudio(b('#!AMR\n'))).toBe('amr');
    expect(sniffAudio(b('fLaC'))).toBe('flac');
    expect(sniffAudio(b('\x1a\x45\xdf\xa3'))).toBe('matroska');
    expect(sniffAudio(b('ID3\x04'))).toBe('mp3');
    expect(sniffAudio(b('\xff\xfb\x90'))).toBe('mp3');
    expect(sniffAudio(b('\xff\xf1\x4c'))).toBe('aac');
    for (const demuxer of new Set([
      'ogg',
      'wav',
      'mov',
      'caf',
      'amr',
      'flac',
      'matroska',
      'mp3',
      'aac',
    ]))
      expect(AUDIO_DEMUXERS).toContain(demuxer);
  });

  it('refuses anything else before FFmpeg runs: playlists, concat lists, images, too short', async () => {
    const { pipe } = fakePipe();
    const attacks = [
      // An HLS playlist pointing at Conch's keys.
      b(
        '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///home/ada/.conch/secrets.json\n#EXT-X-ENDLIST\n',
      ),
      // FFmpeg's concat list.
      b("ffconcat version 1.0\nfile '/home/ada/.conch/channels.secrets.json'\n"),
      // A subfile URL.
      b('subfile,,start,0,end,0,,:/home/ada/.conch/secrets.json'),
      // A picture.
      b('\x89PNG\r\n\x1a\n'),
      b('Og'),
    ];
    for (const attack of attacks) {
      expect(sniffAudio(attack)).toBeUndefined();
      await expect(toWav16k({ ffmpeg: '/bin/ffmpeg', pipe }, attack, 600)).rejects.toBeInstanceOf(
        AudioError,
      );
    }
    expect(pipe).not.toHaveBeenCalled();
  });

  it('refuses a voice note bigger than any ten minutes could be, before FFmpeg runs', async () => {
    const { pipe } = fakePipe();
    const huge = Buffer.alloc(MAX_NOTE_BYTES + 1);
    huge.write('OggS', 0, 'ascii');
    await expect(toWav16k({ ffmpeg: '/bin/ffmpeg', pipe }, huge, 600)).rejects.toThrow(/too big/);
    expect(pipe).not.toHaveBeenCalled();
  });

  it('tells FFmpeg the demuxer it sniffed, lets it open no other, and gives it only pipes', async () => {
    const { pipe, calls } = fakePipe();
    // Ogg's magic, with a playlist after it: Ogg is all FFmpeg may read it as.
    const polyglot = b('OggS\0#EXTM3U\n#EXTINF:1,\nfile:///home/ada/.conch/secrets.json\n');
    const wav = await toWav16k({ ffmpeg: '/bin/ffmpeg', pipe }, polyglot, 600);
    const args = calls[0] ?? [];
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(at('-f')).toBe('ogg');
    expect(at('-protocol_whitelist')).toBe('pipe');
    expect(at('-format_whitelist')?.split(',').sort()).toEqual([...AUDIO_DEMUXERS].sort());
    expect(at('-i')).toBe('pipe:0');
    expect(args.at(-1)).toBe('pipe:1');
    // The input's name or claimed type never reaches the command line.
    expect(args.join(' ')).not.toMatch(/secrets|file:/);
    // Sizes filled in, as a plain WAV.
    expect(wav.readUInt32LE(40)).toBe(3200);
    expect(wavSeconds(wav)).toBeCloseTo(0.1, 3);
  });

  it('makes voice notes from Conch’s own WAV, through pipes only', async () => {
    const { pipe, calls } = fakePipe();
    await toVoiceNote(
      { ffmpeg: '/bin/ffmpeg', pipe },
      sized(b('RIFF\0\0\0\0WAVEdata\0\0\0\0')),
      'aac',
    );
    expect(calls[0]?.join(' ')).toContain('-protocol_whitelist pipe');
    expect(calls[0]).toEqual(expect.arrayContaining(['-f', 'wav', '-f', 'adts']));
  });
});

// The same attacks against the real FFmpeg, where this computer has one.
const ffmpeg = await findExecutable('ffmpeg');
const scratch = mkdtempSync(join(tmpdir(), 'conch-ffmpeg-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe.skipIf(!ffmpeg)('the real FFmpeg', () => {
  const secret = join(scratch, 'secrets.json');
  writeFileSync(secret, `{"key":"${'SECRET'.repeat(2000)}"}`);
  const real = { ffmpeg: ffmpeg ?? '' };

  it('reads a real Opus voice note into a 16 kHz WAV', async () => {
    const ogg = execFileSync(ffmpeg ?? '', [
      ...['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'],
      ...['-c:a', 'libopus', '-f', 'ogg', 'pipe:1'],
    ]);
    const wav = await toWav16k(real, ogg, 600);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wavSeconds(wav)).toBeCloseTo(1, 1);
  });

  it('never reads a file a polyglot points at', async () => {
    const polyglot = Buffer.from(
      `OggS\0\0\0\0#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:${secret.replaceAll('\\', '/')}\n#EXT-X-ENDLIST\nffconcat version 1.0\nfile '${secret}'\n`,
    );
    const outcome = await toWav16k(real, polyglot, 600).then(
      (wav) => wav.toString('latin1'),
      (error: Error) => error.message,
    );
    expect(outcome).not.toContain('SECRET');
  });

  it('can’t be made to read a playlist even when asked through the pipe directly', async () => {
    const playlist = Buffer.from(
      `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:${secret.replaceAll('\\', '/')}\n#EXT-X-ENDLIST\n`,
    );
    // Even FFmpeg told to use HLS refuses: it isn't on the list, and files aren't either.
    const result = await pipeThrough(
      ffmpeg ?? '',
      [
        ...['-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'pipe'],
        ...['-format_whitelist', AUDIO_DEMUXERS.join(','), '-f', 'hls', '-i', 'pipe:0'],
        ...['-f', 'wav', 'pipe:1'],
      ],
      playlist,
      { timeout: 30_000, maxOut: 1_000_000 },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout.toString('latin1')).not.toContain('SECRET');
  });
});
