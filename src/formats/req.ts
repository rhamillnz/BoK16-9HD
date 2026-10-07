import { Reader } from './reader';

/**
 * REQ_*.DAT request layouts: a panel of widgets (buttons, labels, map spots) with positions in
 * 320x200 screen pixels. Only what the temple screens need is decoded. See docs/formats/temples.md.
 */

export interface ReqWidget {
  widget: number;
  action: number;
  visible: boolean;
  /** Position relative to the panel (x, y). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Teleport destination index, or -1. */
  teleport: number;
  image: number;
  group: number;
  /** Label text, or '' when the widget has none. */
  label: string;
}

export interface ReqLayout {
  popup: boolean;
  /** Panel position, size and the inner offset widgets are placed from. */
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  widgets: ReqWidget[];
}

const HEADER_SIZE = 0x1e;
const WIDGET_SIZE = 33;

export function parseReq(bytes: Uint8Array): ReqLayout {
  const r = new Reader(bytes);
  r.skip(2);
  const popup = r.i16() !== 0;
  r.skip(2);
  const x = r.i16();
  const y = r.i16();
  const width = r.i16();
  const height = r.i16();
  r.skip(2);
  const offsetX = r.i16();
  const offsetY = r.i16();
  r.skip(8);
  const count = r.u16();
  if (r.pos !== HEADER_SIZE || r.remaining < count * WIDGET_SIZE) {
    throw new RangeError(`REQ layout truncated: ${count} widgets in ${bytes.length} bytes`);
  }
  const widgets: ReqWidget[] = [];
  const stringOffsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const widget = r.u16();
    const action = r.i16();
    const visible = r.u8() > 0;
    r.skip(6);
    const wx = r.i16();
    const wy = r.i16();
    const ww = r.u16();
    const wh = r.u16();
    r.skip(2);
    stringOffsets.push(r.i16());
    const teleport = r.i16();
    const image = r.u16();
    r.skip(2);
    const group = r.u16();
    r.skip(2);
    widgets.push({ widget, action, visible, x: wx, y: wy, width: ww, height: wh, teleport, image: (image >> 1) + (image & 1), group, label: '' });
  }
  r.skip(2);
  const stringStart = r.pos;
  for (let i = 0; i < count; i++) {
    const off = stringOffsets[i]!;
    if (off < 0 || stringStart + off >= bytes.length) continue;
    r.pos = stringStart + off;
    let end = r.pos;
    while (end < bytes.length && bytes[end] !== 0) end++;
    widgets[i]!.label = String.fromCharCode(...bytes.subarray(r.pos, end));
  }
  return { popup, x, y, width, height, offsetX, offsetY, widgets };
}
