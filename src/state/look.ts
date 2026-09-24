export interface Look {
  readonly text: string;
  readonly ink: string;
  readonly font: number;
  readonly lift: number;
  readonly thickness: number;
  readonly size: number;
  readonly ior: number;
  readonly aberration: number;
  readonly front: number;
  readonly back: number;
  readonly reflections: number;
  readonly light: number;
  readonly shine: number;
  readonly occlusion: number;
  readonly background: string;
  readonly shadow: number;
  readonly fov: number;
  readonly float: number;
  readonly sway: number;
  readonly follow: number;
  readonly focus: number;
  readonly blur: number;
  readonly shade: number;
}

type KeysOf<T> = { [K in keyof Look]: Look[K] extends T ? K : never }[keyof Look];
export type NumberKey = KeysOf<number>;
export type ColorKey = "ink" | "background";
export type TextKey = "text";

export type Control =
  | {
      readonly kind: "range";
      readonly key: NumberKey;
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly unit?: string;
    }
  | { readonly kind: "color"; readonly key: ColorKey; readonly label: string }
  | { readonly kind: "text"; readonly key: TextKey; readonly label: string };

export interface Section {
  readonly title: string;
  readonly controls: readonly Control[];
}

const range = (
  key: NumberKey,
  label: string,
  min: number,
  max: number,
  step: number,
  unit?: string,
): Control => ({ kind: "range", key, label, min, max, step, unit });

export const SECTIONS: readonly Section[] = [
  {
    title: "Words",
    controls: [
      { kind: "text", key: "text", label: "Words" },
      { kind: "color", key: "ink", label: "Ink" },
      range("font", "Size", 4, 24, 0.1),
      range("lift", "Lift", -8, 8, 0.1),
    ],
  },
  {
    title: "Knot",
    controls: [range("thickness", "Tube", 0.6, 2.2, 0.01, "×"), range("size", "Size", 2, 7, 0.05)],
  },
  {
    title: "Glass",
    controls: [
      range("ior", "Refraction", 1, 2.33, 0.01),
      range("aberration", "Dispersion", 0, 0.2, 0.005),
      range("front", "Front depth", 0, 6, 0.05),
      range("back", "Back depth", 0, 12, 0.1),
      range("reflections", "Reflections", 0, 3, 0.05),
      range("light", "Light panel", 0, 16, 0.1),
      range("shine", "Highlight", 0, 8, 0.1),
      range("occlusion", "Contact shade", 0, 1, 0.01),
    ],
  },
  {
    title: "Scene",
    controls: [
      { kind: "color", key: "background", label: "Background" },
      range("shadow", "Shadow", 0, 1, 0.01),
      range("fov", "Lens", 25, 90, 1, "°"),
    ],
  },
  {
    title: "Motion",
    controls: [
      range("float", "Float", 0, 4, 0.05),
      range("sway", "Sway", 0, 3, 0.05),
      range("follow", "Follow pointer", 0, 2, 0.05),
    ],
  },
  {
    title: "Blur",
    controls: [
      range("focus", "Focus band", 0, 1, 0.01),
      range("blur", "Blur", 0, 1, 0.01),
      range("shade", "Floor shade", 0, 0.6, 0.01),
    ],
  },
];

export const CONTROLS: readonly Control[] = SECTIONS.flatMap((section) => section.controls);

export const DEFAULT_LOOK: Look = {
  text: "/ship",
  ink: "#000000",
  font: 14,
  lift: 0,
  thickness: 1.8,
  size: 5,
  ior: 1.5,
  aberration: 0.06,
  front: 2,
  back: 5,
  reflections: 1,
  light: 8,
  shine: 2.5,
  occlusion: 0.45,
  background: "#e0e0e0",
  shadow: 0.95,
  fov: 50,
  float: 2,
  sway: 1,
  follow: 1,
  focus: 0.12,
  blur: 1,
  shade: 0.22,
};

const HEX = /^#[0-9a-f]{6}$/i;
const WORDS = 32;

export function limit(key: NumberKey, value: number): number {
  const control = CONTROLS.find((c) => c.key === key);
  return control?.kind === "range" ? Math.min(control.max, Math.max(control.min, value)) : value;
}

function read(control: Control, value: unknown, fallback: Look[keyof Look]): Look[keyof Look] {
  if (control.kind === "range")
    return typeof value === "number" && Number.isFinite(value) ? limit(control.key, value) : fallback;
  if (control.kind === "color")
    return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback;
  return typeof value === "string" && value.trim() ? value.slice(0, WORDS) : fallback;
}

export function readLook(source: unknown, base: Look = DEFAULT_LOOK): Look {
  if (typeof source !== "object" || source === null) return base;
  const input = source as Record<string, unknown>;
  return Object.fromEntries(
    CONTROLS.map((control) => [control.key, read(control, input[control.key], base[control.key])]),
  ) as unknown as Look;
}

export function linear(hex: string): [number, number, number] {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(1), channel(2)];
}
