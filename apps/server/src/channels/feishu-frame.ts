/**
 * The frames of Feishu's (and Lark's) long connection: protobuf, as
 * `pbbp2.proto` in Feishu's own SDKs describes them (oapi-sdk-go `ws/pbbp2.pb.go`,
 * oapi-sdk-nodejs `ws-client/proto-buf`):
 *
 * ```proto
 * message Header { required string key = 1; required string value = 2; }
 * message Frame {
 *   required uint64 SeqID = 1;  required uint64 LogID = 2;
 *   required int32 service = 3; required int32 method = 4;
 *   repeated Header headers = 5;
 *   optional string payload_encoding = 6; optional string payload_type = 7;
 *   optional bytes payload = 8; optional string LogIDNew = 9;
 * }
 * ```
 *
 * Only these two messages ever cross the socket, so a few dozen lines of
 * wire format beat a protobuf library. Decoding is total: anything that
 * isn't a well-formed frame is `undefined`, never an exception.
 */

/** `method`: a control frame (ping, pong) or a data frame (an event, a card's callback). */
export const CONTROL = 0;
export const DATA = 1;

export interface FeishuFrame {
  seqId: bigint;
  logId: bigint;
  service: number;
  method: number;
  headers: [string, string][];
  payloadEncoding?: string;
  payloadType?: string;
  payload?: Uint8Array;
  logIdNew?: string;
}

/** A frame's header by name. */
export const header = (frame: FeishuFrame, key: string) =>
  frame.headers.find(([k]) => k === key)?.[1];

const text = new TextEncoder();
const words = new TextDecoder();

function varint(out: number[], value: bigint) {
  let v = BigInt.asUintN(64, value);
  while (v > 0x7fn) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
}

function tag(out: number[], field: number, wire: number) {
  varint(out, BigInt((field << 3) | wire));
}

function bytes(out: number[], field: number, value: Uint8Array) {
  tag(out, field, 2);
  varint(out, BigInt(value.length));
  for (const b of value) out.push(b);
}

export function encodeFrame(frame: FeishuFrame): Uint8Array {
  const out: number[] = [];
  tag(out, 1, 0);
  varint(out, frame.seqId);
  tag(out, 2, 0);
  varint(out, frame.logId);
  tag(out, 3, 0);
  varint(out, BigInt(frame.service));
  tag(out, 4, 0);
  varint(out, BigInt(frame.method));
  for (const [key, value] of frame.headers) {
    const inner: number[] = [];
    bytes(inner, 1, text.encode(key));
    bytes(inner, 2, text.encode(value));
    bytes(out, 5, Uint8Array.from(inner));
  }
  if (frame.payloadEncoding !== undefined) bytes(out, 6, text.encode(frame.payloadEncoding));
  if (frame.payloadType !== undefined) bytes(out, 7, text.encode(frame.payloadType));
  if (frame.payload !== undefined) bytes(out, 8, frame.payload);
  if (frame.logIdNew !== undefined) bytes(out, 9, text.encode(frame.logIdNew));
  return Uint8Array.from(out);
}

class Reader {
  at = 0;
  constructor(readonly buf: Uint8Array) {}

  get done() {
    return this.at >= this.buf.length;
  }

  varint(): bigint {
    let value = 0n;
    let shift = 0n;
    for (;;) {
      if (this.at >= this.buf.length || shift > 63n) throw new RangeError('varint');
      const b = this.buf[this.at++] ?? 0;
      value |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return value;
      shift += 7n;
    }
  }

  bytes(): Uint8Array {
    const length = Number(this.varint());
    if (length < 0 || this.at + length > this.buf.length) throw new RangeError('length');
    const value = this.buf.subarray(this.at, this.at + length);
    this.at += length;
    return value;
  }

  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 2) this.bytes();
    else if (wire === 1) this.at += 8;
    else if (wire === 5) this.at += 4;
    else throw new RangeError('wire type');
    if (this.at > this.buf.length) throw new RangeError('past the end');
  }
}

function decodeHeader(buf: Uint8Array): [string, string] {
  const r = new Reader(buf);
  let key = '';
  let value = '';
  while (!r.done) {
    const t = Number(r.varint());
    const field = t >> 3;
    const wire = t & 7;
    if (field === 1 && wire === 2) key = words.decode(r.bytes());
    else if (field === 2 && wire === 2) value = words.decode(r.bytes());
    else r.skip(wire);
  }
  return [key, value];
}

export function decodeFrame(buf: Uint8Array): FeishuFrame | undefined {
  try {
    const r = new Reader(buf);
    const frame: FeishuFrame = { seqId: 0n, logId: 0n, service: 0, method: -1, headers: [] };
    while (!r.done) {
      const t = Number(r.varint());
      const field = t >> 3;
      const wire = t & 7;
      if (wire === 0 && field >= 1 && field <= 4) {
        const v = r.varint();
        if (field === 1) frame.seqId = v;
        else if (field === 2) frame.logId = v;
        else if (field === 3) frame.service = Number(BigInt.asIntN(32, v));
        else frame.method = Number(BigInt.asIntN(32, v));
      } else if (wire === 2 && field === 5) frame.headers.push(decodeHeader(r.bytes()));
      else if (wire === 2 && field === 6) frame.payloadEncoding = words.decode(r.bytes());
      else if (wire === 2 && field === 7) frame.payloadType = words.decode(r.bytes());
      else if (wire === 2 && field === 8) frame.payload = r.bytes().slice();
      else if (wire === 2 && field === 9) frame.logIdNew = words.decode(r.bytes());
      else r.skip(wire);
    }
    return frame.method === CONTROL || frame.method === DATA ? frame : undefined;
  } catch {
    return undefined;
  }
}
