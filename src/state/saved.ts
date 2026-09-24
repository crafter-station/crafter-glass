import { DEFAULT_LOOK, readLook, type Look } from "./look";

const KEY = "crafter-glass:state";

export function load(): Look {
  try {
    return readLook(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_LOOK;
  }
}

export function save(look: Look): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    return;
  }
}
