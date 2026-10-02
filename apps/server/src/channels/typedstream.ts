/**
 * The words of an iMessage from its `attributedBody`.
 *
 * Since macOS Ventura, Messages often leaves `message.text` empty and keeps
 * the words only in `attributedBody`: an `NSAttributedString` archived with
 * NeXTSTEP's `typedstream` format. Its string comes right after the class
 * name `NSString` (or `NSMutableString`), as a `+` (C string) entry: a
 * length, then that many bytes of UTF-8. A length under 0x80 is one byte;
 * 0x81 says a 16-bit and 0x82 a 32-bit little-endian length follows.
 *
 * This reads only that string, never the attributes, and gives up (returns
 * undefined) on anything that doesn't add up, so a strange archive is
 * skipped rather than misread. Formats from imessage-exporter's
 * `crabstep` and Apple's `typedstream.h`.
 */
const CLASS_NAMES = [Buffer.from('NSString'), Buffer.from('NSMutableString')];
/** How far past the class name the `+` may be (its version and type bytes come first). */
const LOOKAHEAD = 16;

export function attributedText(blob: Uint8Array | null | undefined): string | undefined {
  if (!blob || blob.length < 16) return undefined;
  const bytes = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (!bytes.subarray(0, 16).includes(Buffer.from('streamtyped'))) return undefined;
  for (const name of CLASS_NAMES) {
    let from = 0;
    for (;;) {
      const at = bytes.indexOf(name, from);
      if (at < 0) break;
      from = at + name.length;
      const text = stringAfter(bytes, at + name.length);
      if (text !== undefined) return text;
    }
  }
  return undefined;
}

function stringAfter(bytes: Buffer, start: number): string | undefined {
  const end = Math.min(bytes.length, start + LOOKAHEAD);
  for (let i = start; i < end; i++) {
    if (bytes[i] !== 0x2b) continue;
    const read = length(bytes, i + 1);
    if (!read) return undefined;
    const [size, offset] = read;
    if (size <= 0 || offset + size > bytes.length) return undefined;
    const text = bytes.subarray(offset, offset + size).toString('utf8');
    // A wrong guess decodes to replacement characters: not this one.
    if (text.includes('�')) return undefined;
    return text;
  }
  return undefined;
}

/** A typedstream integer at `at`: its value and where what follows starts. */
function length(bytes: Buffer, at: number): [number, number] | undefined {
  const first = bytes[at];
  if (first === undefined) return undefined;
  if (first === 0x81) {
    if (at + 3 > bytes.length) return undefined;
    return [bytes.readUInt16LE(at + 1), at + 3];
  }
  if (first === 0x82) {
    if (at + 5 > bytes.length) return undefined;
    return [bytes.readUInt32LE(at + 1), at + 5];
  }
  if (first >= 0x80) return undefined;
  return [first, at + 1];
}

/**
 * An `attributedBody` for `text`, laid out as Messages writes it: for the
 * pretend Messages in tests, so the decoder is tested against the format,
 * not against itself alone.
 */
export function archiveText(text: string): Buffer {
  const utf8 = Buffer.from(text, 'utf8');
  const size =
    utf8.length < 0x80
      ? Buffer.from([utf8.length])
      : utf8.length <= 0xffff
        ? Buffer.concat([Buffer.from([0x81]), u16(utf8.length)])
        : Buffer.concat([Buffer.from([0x82]), u32(utf8.length)]);
  return Buffer.concat([
    Buffer.from([0x04, 0x0b]),
    Buffer.from('streamtyped'),
    Buffer.from([0x81, 0xe8, 0x03, 0x84, 0x01, 0x40, 0x84, 0x84, 0x84, 0x12]),
    Buffer.from('NSAttributedString'),
    Buffer.from([0x00, 0x84, 0x84, 0x08]),
    Buffer.from('NSObject'),
    Buffer.from([0x00, 0x85, 0x92, 0x84, 0x84, 0x84, 0x08]),
    Buffer.from('NSString'),
    Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]),
    size,
    utf8,
    Buffer.from([0x86, 0x84, 0x02, 0x69, 0x49, 0x01]),
    u16(Math.min(text.length, 0xffff)),
    Buffer.from([0x92, 0x84, 0x84, 0x84, 0x0c]),
    Buffer.from('NSDictionary'),
    Buffer.from([0x00, 0x94, 0x84, 0x01, 0x69, 0x01, 0x92, 0x84, 0x96, 0x96, 0x1d]),
    Buffer.from('__kIMMessagePartAttributeName'),
    Buffer.from([0x86, 0x92, 0x84, 0x84, 0x84, 0x08]),
    Buffer.from('NSNumber'),
    Buffer.from([0x00, 0x84, 0x84, 0x07]),
    Buffer.from('NSValue'),
    Buffer.from([0x00, 0x94, 0x84, 0x01, 0x2a, 0x84, 0x99, 0x99, 0x00, 0x86, 0x86, 0x86]),
  ]);
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
