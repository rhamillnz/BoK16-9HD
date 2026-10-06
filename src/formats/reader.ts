/** Little-endian cursor over a byte buffer. All BaK data is little-endian. */
export class Reader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  pos = 0;

  constructor(bytes: Uint8Array, pos = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  get length(): number {
    return this.bytes.length;
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  atEnd(): boolean {
    return this.pos >= this.bytes.length;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new RangeError(`read of ${n} bytes at ${this.pos} past end (${this.bytes.length})`);
    }
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.pos++]!;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** Returns a view (no copy) of the next n bytes. */
  bytesView(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** Fixed-width NUL-padded ASCII string. */
  fixedString(n: number): string {
    const raw = this.bytesView(n);
    const end = raw.indexOf(0);
    return String.fromCharCode(...(end < 0 ? raw : raw.subarray(0, end)));
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
}
