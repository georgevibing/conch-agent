/**
 * Disposable archive reader (ADR 0017): bytes in on stdin, a listing and the
 * text of a few small members out on stdout. No file system, subprocess or
 * network permission (`worker.ts`), so a name like `../../.ssh/x` is only ever
 * a string here, and nothing is unpacked anywhere. ZIP is read from its
 * central directory, tar block by block; gzip and zstd are expanded with
 * Node's zlib, under limits on entries, expanded bytes and ratio.
 */
import zlib from 'node:zlib';

/** Most entries looked at; past it the count is "more than". */
const MAX_ENTRIES = 100_000;
/** Most entries described in the answer. */
const MAX_LISTED = 2_000;
/** Bytes of members actually inflated from a ZIP, in all. */
const ZIP_INFLATE_MAX = 48 * 1024 * 1024;
/** A member this much larger than its compressed self is a bomb, not a file. */
const MAX_RATIO = 1_000;
/** Largest member read as text. */
const TEXT_EACH = 256 * 1024;
/** Text members held while a tar streams past. */
const KEEP_TEXT_TOTAL = 16 * 1024 * 1024;
/** Documents (PDF, DOCX…) handed back for the other readers. */
const DOC_EACH = 10 * 1024 * 1024;
const DOC_TOTAL = 16 * 1024 * 1024;
const DOC_COUNT = 2;
/** Most members tried as text. */
const MAX_TRIES = 400;
/** Most members held while a tar streams past. */
const KEEP_COUNT = 2_000;

const DOC_EXT = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'rtf']);
const BINARY_EXT = new Set(
  (
    'png jpg jpeg gif webp bmp ico icns tif tiff heic avif psd mp3 wav m4a ogg flac mp4 mov webm ' +
    'avi mkv zip jar war apk aar gz tgz bz2 xz zst 7z rar tar so dylib dll exe o a lib class dex ' +
    'pyc pyo wasm bin dat db sqlite woff woff2 ttf otf eot keystore jks p12 der pdf docx xlsx pptx ' +
    'doc xls ppt odt ods odp epub arsc'
  ).split(' '),
);
const TEXT_EXT = new Set(
  (
    'txt md markdown rst adoc org csv tsv log js mjs cjs ts tsx jsx json jsonc json5 yaml yml toml ' +
    'ini cfg conf env properties xml html htm css scss sass less svg py rb go rs java kt kts scala ' +
    'swift m mm c h cc cpp hpp cs fs vb php pl pm lua r jl dart ex exs erl hs ml clj sh bash zsh fish ' +
    'ps1 bat cmd sql graphql proto gradle tf hcl vue svelte astro mf plist ipynb tex bib'
  ).split(' '),
);
const MANIFESTS = new Set([
  'package.json',
  'cargo.toml',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'gemfile',
  'composer.json',
  'makefile',
  'cmakelists.txt',
  'dockerfile',
  'manifest.mf',
  'manifest.json',
  'pubspec.yaml',
  'mix.exs',
  'deno.json',
  'tsconfig.json',
]);
const LOCKS = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'cargo.lock',
  'poetry.lock',
  'gemfile.lock',
  'composer.lock',
  'go.sum',
]);
const NOISE =
  /(^|\/)(node_modules|\.git|\.svn|\.hg|__MACOSX|\.idea|\.vscode|dist|build|target|vendor|\.venv|venv|__pycache__|\.next|coverage)\//i;

/** A name that would land outside a folder it was unpacked into, or is a device. */
function unsafeName(name) {
  return (
    name.startsWith('/') ||
    name.includes('\\') ||
    /^[a-z]:/i.test(name) ||
    name.split('/').some((part) => part === '..') ||
    name.includes('\0')
  );
}

const ext = (path) => {
  const base = path.split('/').at(-1) ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};

/** How much a member is worth showing as text: README first, then manifests, then source. 0: never. */
function textScore(path) {
  const base = (path.split('/').at(-1) ?? '').toLowerCase();
  if (!base || base.startsWith('._') || base === '.ds_store' || base === 'thumbs.db') return 0;
  const e = ext(path);
  if (BINARY_EXT.has(e)) return 0;
  const depth = path.split('/').length - 1;
  let score;
  if (/^readme(\.|$)/.test(base)) score = 100;
  else if (MANIFESTS.has(base) || /\.(csproj|fsproj|gemspec|cabal|nuspec)$/.test(base)) score = 90;
  else if (LOCKS.has(base)) score = 4;
  else if (/\.min\.(js|css)$/.test(base) || base.endsWith('.map')) score = 2;
  else if (/^(license|licence|copying|notice)(\.|$)/.test(base)) score = 20;
  else if (/^(changelog|changes|history|contributing)(\.|$)/.test(base)) score = 30;
  else if (['md', 'markdown', 'rst', 'txt', 'adoc', 'org'].includes(e)) score = 70;
  else if (TEXT_EXT.has(e)) score = 60;
  else score = 10;
  if (NOISE.test(path)) score = Math.min(score, 3);
  return Math.max(1, score - depth * 3);
}

/** UTF-8 without NUL bytes; `cut`: the bytes stop early, so a character split at the end is dropped. */
function decodeText(bytes, cut = false) {
  if (bytes.includes(0)) return undefined;
  for (let back = 0; back <= (cut ? 3 : 0); back++) {
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
        bytes.subarray(0, bytes.length - back),
      );
    } catch {
      // Try a byte shorter.
    }
  }
  return undefined;
}

/** Names, without control or bidirectional characters, never longer than 300. */
function shown(name) {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what's removed
  return name.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '?').slice(0, 300);
}

class Listing {
  entries = [];
  total = 0;
  files = 0;
  dirs = 0;
  links = 0;
  unsafe = 0;
  encrypted = 0;
  unsupported = 0;
  bytes = 0;
  /** Files with something in them. */
  filled = 0;
  /** More entries than MAX_ENTRIES, or the stream stopped early. */
  incomplete = false;

  add(entry) {
    this.total++;
    if (entry.type === 'dir') this.dirs++;
    else if (entry.type === 'link') this.links++;
    else if (entry.type === 'file') {
      this.files++;
      this.bytes += entry.size;
      if (entry.size > 0) this.filled++;
    }
    if (entry.unsafe) this.unsafe++;
    if (entry.encrypted) this.encrypted++;
    if (this.entries.length < MAX_LISTED) this.entries.push(entry);
  }
}

// ── ZIP ────────────────────────────────────────────────────────────────────

function dosTime(date, time) {
  if (!date) return null;
  const year = 1980 + (date >> 9);
  const month = ((date >> 5) & 15) - 1;
  const day = date & 31;
  const ms = Date.UTC(year, month, day, time >> 11, (time >> 5) & 63, (time & 31) * 2);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function readZip(bytes, listing) {
  const min = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0)
    throw new Error('This ZIP has no directory of its contents; it may be cut off or damaged.');
  let count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff) {
    // ZIP64: the real numbers are in a record the locator points to.
    const locator = end - 20;
    if (locator >= 0 && bytes.readUInt32LE(locator) === 0x07064b50) {
      const record = Number(bytes.readBigUInt64LE(locator + 8));
      if (record + 56 <= bytes.length && bytes.readUInt32LE(record) === 0x06064b50) {
        count = Number(bytes.readBigUInt64LE(record + 32));
        offset = Number(bytes.readBigUInt64LE(record + 48));
      }
    }
  }
  const members = [];
  let at = offset;
  // By signature, not only the count: writers without ZIP64 wrap it past 65 535 entries.
  for (let n = 0; ; n++) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50) {
      if (n < count) listing.incomplete = true;
      break;
    }
    if (n >= MAX_ENTRIES) {
      // Past the limit only counted, never described, and never more than the file can hold.
      listing.incomplete = true;
      while (at + 46 <= bytes.length && bytes.readUInt32LE(at) === 0x02014b50) {
        listing.total++;
        at +=
          46 +
          bytes.readUInt16LE(at + 28) +
          bytes.readUInt16LE(at + 30) +
          bytes.readUInt16LE(at + 32);
      }
      break;
    }
    const madeBy = bytes.readUInt16LE(at + 4);
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const time = bytes.readUInt16LE(at + 12);
    const date = bytes.readUInt16LE(at + 14);
    let csize = bytes.readUInt32LE(at + 20);
    let size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const external = bytes.readUInt32LE(at + 38);
    let local = bytes.readUInt32LE(at + 42);
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = new TextDecoder('utf-8').decode(nameBytes);
    let mtime = dosTime(date, time);
    const extra = bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    for (let x = 0; x + 4 <= extra.length;) {
      const id = extra.readUInt16LE(x);
      const length = extra.readUInt16LE(x + 2);
      const body = extra.subarray(x + 4, x + 4 + length);
      if (id === 0x0001) {
        let y = 0;
        const next = () => {
          if (y + 8 > body.length) return undefined;
          const value = Number(body.readBigUInt64LE(y));
          y += 8;
          return value;
        };
        if (size === 0xffffffff) size = next() ?? size;
        if (csize === 0xffffffff) csize = next() ?? csize;
        if (local === 0xffffffff) local = next() ?? local;
      } else if (id === 0x5455 && body.length >= 5 && body[0] & 1) {
        mtime = body.readUInt32LE(1);
      }
      x += 4 + length;
    }
    at += 46 + nameLength + extraLength + commentLength;
    const unixMode = madeBy >> 8 === 3 ? external >>> 16 : 0;
    const link = (unixMode & 0o170000) === 0o120000;
    const dir = name.endsWith('/') || (external & 0x10) !== 0;
    const entry = {
      path: name,
      size: dir || link ? 0 : size,
      mtime,
      type: link ? 'link' : dir ? 'dir' : 'file',
      unsafe: unsafeName(name),
      encrypted: (flags & 1) !== 0,
    };
    listing.add(entry);
    if (entry.type === 'file') members.push({ entry, method, csize, size, local });
  }
  let inflated = 0;
  const byEntry = new Map(members.map((m) => [m.entry, m]));
  return {
    members: members.map((m) => m.entry),
    /** A member's bytes, or undefined. At most `cap` bytes are expanded. */
    open(entry, cap) {
      const m = byEntry.get(entry);
      if (!m || entry.encrypted || entry.unsafe) return undefined;
      if (m.size > cap) return undefined;
      if (m.size > 1024 * 1024 && m.size / Math.max(1, m.csize) > MAX_RATIO) return undefined;
      if (inflated + m.size > ZIP_INFLATE_MAX) return undefined;
      const h = m.local;
      if (h + 30 > bytes.length || bytes.readUInt32LE(h) !== 0x04034b50) return undefined;
      const start = h + 30 + bytes.readUInt16LE(h + 26) + bytes.readUInt16LE(h + 28);
      const data = bytes.subarray(start, start + m.csize);
      if (data.length < m.csize) return undefined;
      let out;
      try {
        // Never more than the directory promised: a member that lies about its size is dropped.
        const limit = { maxOutputLength: Math.max(1, m.size) };
        if (m.method === 0) out = data;
        else if (m.method === 8) out = m.size ? zlib.inflateRawSync(data, limit) : Buffer.alloc(0);
        else if (m.method === 93) out = zlib.zstdDecompressSync(data, limit);
        else {
          listing.unsupported++;
          return undefined;
        }
      } catch {
        return undefined;
      }
      if (out.length !== m.size) return undefined;
      inflated += out.length;
      return out;
    },
  };
}

// ── tar ────────────────────────────────────────────────────────────────────

function octal(field) {
  // GNU base-256 for large numbers: the high bit of the first byte is set.
  if (field[0] & 0x80) {
    let value = 0;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i];
    return value;
  }
  const text = field.toString('latin1').replace(/\0.*$/s, '').trim();
  return text ? parseInt(text, 8) : 0;
}

function cstring(field) {
  const zero = field.indexOf(0);
  return new TextDecoder('utf-8').decode(zero < 0 ? field : field.subarray(0, zero));
}

function validHeader(h) {
  const stored = octal(h.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  return Number.isFinite(stored) && stored === sum;
}

function paxRecords(body) {
  const out = {};
  const text = body.toString('utf8');
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    if (space < 0) break;
    const length = Number(text.slice(i, space));
    if (!Number.isInteger(length) || length <= 0) break;
    const record = text.slice(space + 1, i + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += length;
  }
  return out;
}

/** Reads a tar as it streams past, keeping only the members worth reading. */
class TarStream {
  pending = Buffer.alloc(0);
  /** Body bytes still to pass for the current member. */
  remaining = 0;
  padding = 0;
  current = undefined;
  collected = [];
  collecting = false;
  pax = {};
  longName = undefined;
  zeros = 0;
  done = false;
  headers = 0;
  keptText = 0;
  keptDocs = 0;
  /** Bodies kept, by entry. */
  kept = new Map();
  members = [];

  constructor(listing) {
    this.listing = listing;
  }

  push(chunk) {
    let data = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    this.pending = Buffer.alloc(0);
    while (!this.done && data.length) {
      if (this.remaining > 0) {
        const take = Math.min(this.remaining, data.length);
        if (this.collecting) this.collected.push(data.subarray(0, take));
        data = data.subarray(take);
        this.remaining -= take;
        if (this.remaining === 0) this.finishBody();
        continue;
      }
      if (this.padding > 0) {
        const take = Math.min(this.padding, data.length);
        data = data.subarray(take);
        this.padding -= take;
        continue;
      }
      if (data.length < 512) {
        this.pending = Buffer.from(data);
        return;
      }
      const header = data.subarray(0, 512);
      data = data.subarray(512);
      this.header(header);
    }
  }

  header(h) {
    if (h.every((b) => b === 0)) {
      if (++this.zeros >= 2) this.done = true;
      return;
    }
    this.zeros = 0;
    if (++this.headers > MAX_ENTRIES * 2) {
      this.listing.incomplete = true;
      this.done = true;
      return;
    }
    if (!validHeader(h)) {
      if (!this.listing.total)
        throw new Error('This isn’t a tar archive Conch can read; it may be damaged.');
      this.listing.incomplete = true;
      this.done = true;
      return;
    }
    const type = String.fromCharCode(h[156] || 48);
    const size = octal(h.subarray(124, 136));
    if (!Number.isFinite(size) || size < 0) {
      this.listing.incomplete = true;
      this.done = true;
      return;
    }
    const ustar = h.subarray(257, 262).toString('latin1') === 'ustar';
    const prefix = ustar ? cstring(h.subarray(345, 500)) : '';
    let path = cstring(h.subarray(0, 100));
    if (prefix) path = `${prefix}/${path}`;
    if (this.longName !== undefined) path = this.longName;
    if (this.pax.path !== undefined) path = this.pax.path;
    let length = size;
    if (this.pax.size !== undefined && /^\d+$/.test(this.pax.size)) length = Number(this.pax.size);
    const mtime =
      this.pax.mtime !== undefined
        ? Math.floor(Number(this.pax.mtime))
        : octal(h.subarray(136, 148));
    const meta = type === 'x' || type === 'g' || type === 'L' || type === 'K';
    this.current = { type, meta, size: length };
    this.remaining = length;
    this.padding = (512 - (length % 512)) % 512;
    this.collected = [];
    this.collecting = false;
    if (meta) {
      // A pax record or a long name is small; one that isn't is skipped, not believed.
      this.collecting = length <= 64 * 1024 && type !== 'K';
    } else {
      this.longName = undefined;
      this.pax = {};
      if (this.listing.total >= MAX_ENTRIES) {
        this.listing.incomplete = true;
        this.done = true;
        return;
      }
      const kind =
        type === '5'
          ? 'dir'
          : type === '1' || type === '2'
            ? 'link'
            : type === '0' || type === '7'
              ? 'file'
              : 'other';
      const entry = {
        path,
        size: kind === 'file' ? length : 0,
        mtime: Number.isFinite(mtime) ? mtime : null,
        type: kind,
        unsafe: unsafeName(path),
        encrypted: false,
      };
      this.listing.add(entry);
      this.current.entry = entry;
      if (kind === 'file') {
        this.members.push(entry);
        this.collecting = this.wants(entry);
      }
    }
    if (this.remaining === 0) this.finishBody();
  }

  wants(entry) {
    if (entry.unsafe || entry.size === 0) return false;
    if (DOC_EXT.has(ext(entry.path)))
      return (
        entry.size <= DOC_EACH &&
        this.keptDocs + entry.size <= DOC_TOTAL &&
        this.docCount() < DOC_COUNT * 2
      );
    if (entry.size > TEXT_EACH || textScore(entry.path) === 0) return false;
    if (this.keptText + entry.size <= KEEP_TEXT_TOTAL && this.kept.size < KEEP_COUNT) return true;
    // Full: a better member takes the place of the worst one held.
    const score = textScore(entry.path);
    let worst;
    for (const [held] of this.kept)
      if (!DOC_EXT.has(ext(held.path)) && (!worst || textScore(held.path) < textScore(worst.path)))
        worst = held;
    if (!worst || textScore(worst.path) >= score) return false;
    this.keptText -= worst.size;
    this.kept.delete(worst);
    return this.keptText + entry.size <= KEEP_TEXT_TOTAL && this.kept.size < KEEP_COUNT;
  }

  docCount() {
    let n = 0;
    for (const [held] of this.kept) if (DOC_EXT.has(ext(held.path))) n++;
    return n;
  }

  finishBody() {
    const current = this.current;
    if (!current) return;
    if (current.meta && this.collecting) {
      const body = Buffer.concat(this.collected);
      if (current.type === 'x') this.pax = paxRecords(body);
      else if (current.type === 'L') this.longName = cstring(body);
    } else if (this.collecting && current.entry) {
      const body = Buffer.concat(this.collected);
      this.kept.set(current.entry, body);
      if (DOC_EXT.has(ext(current.entry.path))) this.keptDocs += body.length;
      else this.keptText += body.length;
    }
    this.collected = [];
    this.collecting = false;
    this.current = undefined;
  }

  end() {
    if (!this.done && (this.remaining > 0 || this.pending.length)) this.listing.incomplete = true;
  }
}

function looksLikeTar(bytes) {
  if (bytes.length < 512) return false;
  const h = bytes.subarray(0, 512);
  return h.subarray(257, 262).toString('latin1') === 'ustar' || validHeader(h);
}

/** Streams a gzip or zstd file through `sink`, stopping at `cap` bytes expanded. */
async function expand(bytes, kind, cap, sink) {
  const stream = kind === 'gzip' ? zlib.createGunzip() : zlib.createZstdDecompress();
  let total = 0;
  let stopped = false;
  let broken = false;
  await new Promise((done, failed) => {
    stream.on('data', (chunk) => {
      if (stopped) return;
      const room = cap - total;
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      total += part.length;
      try {
        sink(part);
      } catch (error) {
        stopped = true;
        stream.destroy();
        failed(error);
        return;
      }
      if (total >= cap) {
        stopped = true;
        stream.destroy();
        done();
      }
    });
    stream.on('end', done);
    stream.on('close', done);
    stream.on('error', (error) => {
      // Damaged past the start: what came before still counts, said as cut short.
      broken = true;
      if (total) done();
      else failed(error);
    });
    stream.end(bytes);
  });
  return { total, stopped: stopped || broken };
}

// ── The answer ─────────────────────────────────────────────────────────────

function gzipName(bytes) {
  // FNAME, after FEXTRA when present.
  const flags = bytes[3];
  if (!(flags & 0x08)) return undefined;
  let at = 10;
  if (flags & 0x04) at += 2 + bytes.readUInt16LE(10);
  const zero = bytes.indexOf(0, at);
  if (zero < 0 || zero - at > 255) return undefined;
  const name = bytes.subarray(at, zero).toString('latin1').split(/[\\/]/).at(-1);
  return name || undefined;
}

function strip(name) {
  return name.replace(/\.(t?gz|gzip|zst|zstd|bz2|tbz2?|xz|txz)$/i, (m) =>
    /^\.t/i.test(m) ? '.tar' : '',
  );
}

async function read({ data, name, room, docs, inner, truncated }) {
  const bytes = Buffer.from(data, 'base64');
  const listing = new Listing();
  let format = inner ? 'tar' : undefined;
  let members = [];
  let open = () => undefined;
  let single;
  let expanded = 0;
  let cut = Boolean(truncated);
  /** The one compressed file wasn't kept whole. */
  let singleCut = Boolean(truncated);

  const asTar = (source) => {
    const tar = new TarStream(listing);
    tar.push(source);
    tar.end();
    return tar;
  };
  const fromTar = (tar) => {
    members = tar.members;
    open = (entry) => tar.kept.get(entry);
  };

  const zipMagic = bytes.readUInt32LE(0) === 0x04034b50 || bytes.readUInt32LE(0) === 0x06054b50;
  if (!inner && bytes.length >= 4 && zipMagic) {
    format = 'zip';
    const zip = readZip(bytes, listing);
    members = zip.members;
    open = zip.open;
  } else if (!inner && bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    format = 'gzip';
    const cap = Math.min(512 * 1024 * 1024, Math.max(64 * 1024 * 1024, bytes.length * 100));
    await stream(bytes, 'gzip', cap, gzipName(bytes) ?? strip(name));
  } else if (!inner && bytes.length >= 4 && bytes.readUInt32LE(0) === 0xfd2fb528) {
    format = 'zstd';
    const cap = Math.min(512 * 1024 * 1024, Math.max(64 * 1024 * 1024, bytes.length * 100));
    await stream(bytes, 'zstd', cap, strip(name));
  } else if (looksLikeTar(bytes)) {
    format = 'tar';
    fromTar(asTar(bytes));
  } else if (inner) {
    // A single file someone compressed (notes.txt.xz): the file itself.
    format = 'single';
    single = { path: strip(name) || 'file', bytes };
    const entry = {
      path: single.path,
      size: bytes.length,
      mtime: null,
      type: 'file',
      unsafe: false,
      encrypted: false,
    };
    listing.add(entry);
    members = [entry];
    open = () => single.bytes;
  } else throw new Error('This isn’t an archive Conch can read; it may be damaged.');

  async function stream(source, kind, cap, innerName) {
    // The first block says whether it's a tarball or one compressed file.
    let tar;
    const head = [];
    let headLength = 0;
    let decided = false;
    const result = await expand(source, kind, cap, (chunk) => {
      if (decided) {
        if (tar) tar.push(chunk);
        else if (headLength <= DOC_EACH) {
          head.push(chunk);
          headLength += chunk.length;
        }
        return;
      }
      head.push(chunk);
      headLength += chunk.length;
      if (headLength < 512) return;
      decided = true;
      const first = Buffer.concat(head);
      if (looksLikeTar(first)) {
        tar = new TarStream(listing);
        head.length = 0;
        tar.push(first);
      }
    });
    expanded = result.total;
    if (result.stopped) cut = true;
    if (tar) {
      tar.end();
      fromTar(tar);
      format = 'tar';
      return;
    }
    // One compressed file: show it whole (up to what was kept).
    format = 'single';
    const body = Buffer.concat(head);
    single = { path: innerName || 'file', bytes: body };
    const entry = {
      path: single.path,
      size: result.total,
      mtime: null,
      type: 'file',
      unsafe: false,
      encrypted: false,
    };
    listing.add(entry);
    members = [entry];
    singleCut = result.total !== body.length || result.stopped;
    open = () => (singleCut ? body.subarray(0, TEXT_EACH) : body);
  }

  // Text: the most useful small members first, within `room` characters.
  const texts = [];
  const documents = [];
  let left = room;
  let skippedText = 0;
  let binary = 0;
  let tries = 0;
  const textual = members
    .filter((e) => !e.unsafe && !e.encrypted && e.size > 0 && textScore(e.path) > 0)
    .sort((a, b) => textScore(b.path) - textScore(a.path) || a.path.localeCompare(b.path));
  for (const entry of textual) {
    if (left < 200 || tries >= MAX_TRIES) {
      skippedText++;
      continue;
    }
    if (entry.size > TEXT_EACH && !single) {
      skippedText++;
      continue;
    }
    tries++;
    const body = open(entry, TEXT_EACH);
    const long = body !== undefined && body.length > TEXT_EACH;
    const text =
      body && decodeText(long ? body.subarray(0, TEXT_EACH) : body, long || (single && singleCut));
    if (text === undefined) {
      binary++;
      continue;
    }
    const each = textScore(entry.path) >= 90 ? left : Math.max(2_000, Math.floor(room / 3));
    const take = Math.min(text.length, each, left - shown(entry.path).length - 40);
    if (take <= 0) {
      skippedText++;
      continue;
    }
    texts.push({ path: shown(entry.path), text: text.slice(0, take), cut: take < text.length });
    left -= take + shown(entry.path).length + 40;
  }

  // Documents for the other readers, smallest first.
  let docBytes = 0;
  const docCandidates = members
    .filter((e) => !e.unsafe && !e.encrypted && DOC_EXT.has(ext(e.path)) && e.size <= DOC_EACH)
    .sort((a, b) => a.size - b.size);
  for (const entry of docCandidates) {
    if (!docs || documents.length >= DOC_COUNT || docBytes + entry.size > DOC_TOTAL) break;
    if (single && singleCut) break;
    const body = open(entry, DOC_EACH);
    if (!body) continue;
    docBytes += body.length;
    documents.push({ path: shown(entry.path), data: body.toString('base64') });
  }

  return {
    format,
    entries: listing.entries.map((e) => ({ ...e, path: shown(e.path) })),
    total: listing.total,
    files: listing.files,
    filled: listing.filled,
    dirs: listing.dirs,
    links: listing.links,
    unsafe: listing.unsafe,
    encrypted: listing.encrypted,
    unsupported: listing.unsupported,
    bytes: listing.bytes,
    incomplete: listing.incomplete || cut,
    expanded,
    texts,
    documents,
    skippedText,
    binary,
  };
}

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 70 * 1024 * 1024) throw new Error('Archive input is too large.');
}
try {
  process.stdout.write(JSON.stringify({ result: await read(JSON.parse(input)) }));
} catch (error) {
  const message = error instanceof Error ? error.message : 'The archive could not be read.';
  process.stdout.write(JSON.stringify({ error: message.slice(0, 500) }));
}
