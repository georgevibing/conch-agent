/**
 * The protobuf wire format, as much of it as OTLP needs (ADR 0119): varints,
 * length-delimited fields and messages, 64-bit fixed integers and doubles,
 * packed repeated fields. From protobuf.dev/programming-guides/encoding.
 *
 * A nested message is written into its own writer, then its length and bytes
 * into the parent's, so nothing is measured twice.
 */

export class ProtoWriter {
  #chunks: Uint8Array[] = [];
  #buf = new Uint8Array(256);
  #at = 0;

  #ensure(n: number) {
    if (this.#at + n <= this.#buf.length) return;
    this.#chunks.push(this.#buf.subarray(0, this.#at));
    this.#buf = new Uint8Array(Math.max(256, n, this.#buf.length * 2));
    this.#at = 0;
  }

  #byte(b: number) {
    this.#ensure(1);
    this.#buf[this.#at++] = b;
  }

  #raw(bytes: Uint8Array) {
    this.#ensure(bytes.length);
    this.#buf.set(bytes, this.#at);
    this.#at += bytes.length;
  }

  /** An unsigned varint; a negative int64 is written as its two's complement (ten bytes). */
  varint(value: number | bigint): void {
    let v = BigInt.asUintN(64, BigInt(value));
    while (v > 0x7fn) {
      this.#byte(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    this.#byte(Number(v));
  }

  #tag(field: number, wire: 0 | 1 | 2 | 5) {
    this.varint((field << 3) | wire);
  }

  int64(field: number, value: number | bigint): void {
    this.#tag(field, 0);
    this.varint(value);
  }

  enumValue(field: number, value: number): void {
    this.int64(field, value);
  }

  bool(field: number, value: boolean): void {
    this.#tag(field, 0);
    this.#byte(value ? 1 : 0);
  }

  #fixed64(value: bigint) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, value), true);
    this.#raw(b);
  }

  #double(value: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, value, true);
    this.#raw(b);
  }

  fixed64(field: number, value: bigint): void {
    this.#tag(field, 1);
    this.#fixed64(value);
  }

  double(field: number, value: number): void {
    this.#tag(field, 1);
    this.#double(value);
  }

  bytes(field: number, value: Uint8Array): void {
    this.#tag(field, 2);
    this.varint(value.length);
    this.#raw(value);
  }

  string(field: number, value: string): void {
    this.bytes(field, Buffer.from(value, 'utf8'));
  }

  message(field: number, write: (inner: ProtoWriter) => void): void {
    const inner = new ProtoWriter();
    write(inner);
    this.bytes(field, inner.finish());
  }

  packedFixed64(field: number, values: readonly bigint[]): void {
    if (!values.length) return;
    this.#tag(field, 2);
    this.varint(values.length * 8);
    for (const v of values) this.#fixed64(v);
  }

  packedDouble(field: number, values: readonly number[]): void {
    if (!values.length) return;
    this.#tag(field, 2);
    this.varint(values.length * 8);
    for (const v of values) this.#double(v);
  }

  finish(): Uint8Array {
    const parts = [...this.#chunks, this.#buf.subarray(0, this.#at)];
    if (parts.length === 1) return parts[0]?.slice() ?? new Uint8Array();
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}
