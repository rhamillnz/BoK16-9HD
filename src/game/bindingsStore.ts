import { BINDINGS_KEY, parseBindings, serializeBindings, type Bindings } from '../world/bindings';

let current: Bindings | undefined;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function getBindings(): Bindings {
  current ??= parseBindings(storage()?.getItem(BINDINGS_KEY));
  return current;
}

export function setBindings(b: Bindings): void {
  current = b;
  try {
    storage()?.setItem(BINDINGS_KEY, serializeBindings(b));
  } catch {
    // storage unavailable: the bindings still apply this session
  }
}
