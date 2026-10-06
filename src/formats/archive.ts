import { Reader } from './reader';

/**
 * KRONDOR.RMF is an index; KRONDOR.001 holds the resources.
 *
 * RMF:  u32 = 1, u16 = 4, char[13] archive name, u16 count,
 *       count x { u32 hash, u32 offset into archive }
 * .001: at each offset: char[13] name, u32 size, size bytes of data
 */
export interface ArchiveEntry {
  name: string;
  hash: number;
  offset: number;
  size: number;
}

export class ResourceArchive {
  readonly entries: ArchiveEntry[];
  private readonly byName = new Map<string, ArchiveEntry>();

  constructor(
    rmf: Uint8Array,
    private readonly data: Uint8Array,
  ) {
    const r = new Reader(rmf);
    const sig1 = r.u32();
    const sig2 = r.u16();
    if (sig1 !== 1 || sig2 !== 4) throw new Error(`bad RMF signature ${sig1}/${sig2}`);
    r.fixedString(13);
    const count = r.u16();

    this.entries = [];
    for (let i = 0; i < count; i++) {
      const hash = r.u32();
      const offset = r.u32();
      const d = new Reader(data, offset);
      const name = d.fixedString(13).toUpperCase();
      const size = d.u32();
      const entry = { name, hash, offset: offset + 17, size };
      this.entries.push(entry);
      this.byName.set(name, entry);
    }
    this.entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return this.byName.has(name.toUpperCase());
  }

  /** Returns a view into the archive (no copy). */
  get(name: string): Uint8Array {
    const e = this.byName.get(name.toUpperCase());
    if (!e) throw new Error(`resource not found: ${name}`);
    return this.data.subarray(e.offset, e.offset + e.size);
  }
}
