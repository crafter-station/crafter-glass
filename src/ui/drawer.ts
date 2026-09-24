import { DEFAULT_LOOK, readLook, SECTIONS, type Control, type Look } from "../state/look";
import type { Store } from "../state/store";
import "./drawer.css";

const COPIED = 1400;

export interface DrawerOptions {
  readonly look: Store<Look>;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
  element.append(...children);
  return element;
}

const button = (label: string, action: () => void, className = "") => {
  const element = node("button", { type: "button", class: className }, label);
  element.addEventListener("click", action);
  return element;
};

interface Bound {
  readonly element: HTMLElement;
  sync(look: Look): void;
}

function bind(control: Control, look: Store<Look>): Bound {
  if (control.kind === "color") {
    const input = node("input", { type: "color", "aria-label": control.label });
    input.addEventListener("input", () => look.set({ [control.key]: input.value }));
    return {
      element: node("label", { class: "swatch" }, input, node("span", {}, control.label)),
      sync: (current) => (input.value = current[control.key]),
    };
  }
  if (control.kind === "text") {
    const input = node("input", {
      type: "text",
      "aria-label": control.label,
      spellcheck: "false",
      autocomplete: "off",
      maxlength: "32",
    });
    input.addEventListener("input", () => {
      if (input.value.trim()) look.set({ [control.key]: input.value });
    });
    return {
      element: node("label", { class: "field" }, input),
      sync: (current) => {
        if (document.activeElement !== input) input.value = current[control.key];
      },
    };
  }
  const { key, label, min, max, step, unit = "" } = control;
  const input = node("input", {
    type: "range",
    min: `${min}`,
    max: `${max}`,
    step: `${step}`,
    "aria-label": label,
  });
  const readout = node("span", { class: "value" });
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  input.addEventListener("input", () => look.set({ [key]: Number(input.value) }));
  return {
    element: node("label", { class: "row" }, node("span", {}, label), readout, input),
    sync: (current) => {
      input.value = `${current[key]}`;
      readout.textContent = `${current[key].toFixed(digits)}${unit}`;
    },
  };
}

export function createDrawer({ look }: DrawerOptions): void {
  const handle = node("button", { class: "handle", type: "button", "aria-label": "Open look controls" });
  const close = button("Close", () => setOpen(false));
  const bound: Bound[] = [];
  const sections = SECTIONS.map(({ title, controls }) => {
    const colors = controls.filter((c) => c.kind === "color").map((c) => bind(c, look));
    const rest = controls.filter((c) => c.kind !== "color").map((c) => bind(c, look));
    bound.push(...colors, ...rest);
    const swatches = colors.length
      ? [node("div", { class: "swatches" }, ...colors.map((c) => c.element))]
      : [];
    const [fields, ranges] = [
      rest.filter((c) => c.element.classList.contains("field")),
      rest.filter((c) => !c.element.classList.contains("field")),
    ];
    return node(
      "section",
      {},
      node("h3", {}, title),
      ...fields.map((c) => c.element),
      ...swatches,
      ...ranges.map((c) => c.element),
    );
  });

  const json = node("textarea", {
    class: "json",
    spellcheck: "false",
    "aria-label": "State as JSON",
    rows: "12",
  });
  let copying = 0;
  const copy = button("Copy JSON", async () => {
    const value = text();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      json.value = value;
      json.select();
      document.execCommand("copy");
    }
    copy.textContent = "Copied";
    clearTimeout(copying);
    copying = window.setTimeout(() => (copy.textContent = "Copy JSON"), COPIED);
  });
  const reset = button("Reset", () => look.set(DEFAULT_LOOK), "quiet");

  const sheet = node(
    "aside",
    { class: "sheet", "aria-label": "Look controls" },
    node("div", { class: "top" }, node("span", { class: "title" }, "Look"), close),
    ...sections,
    node("section", {}, node("h3", {}, "State"), json, node("div", { class: "actions" }, copy, reset)),
  );
  document.body.append(handle, sheet);

  const text = () => JSON.stringify(look.get(), null, 2);

  const refresh = () => {
    const current = look.get();
    bound.forEach(({ sync }) => sync(current));
    if (document.activeElement !== json) {
      json.value = text();
      json.removeAttribute("data-invalid");
    }
  };

  json.addEventListener("input", () => {
    try {
      const parsed: unknown = JSON.parse(json.value);
      json.removeAttribute("data-invalid");
      look.set(readLook(parsed, look.get()));
    } catch {
      json.setAttribute("data-invalid", "");
    }
  });
  json.addEventListener("blur", refresh);

  const setOpen = (open: boolean) => {
    sheet.toggleAttribute("data-open", open);
    handle.setAttribute("aria-expanded", `${open}`);
    sheet.inert = !open;
    if (open) refresh();
  };
  handle.addEventListener("click", () => setOpen(true));
  window.addEventListener("keydown", (event) => event.key === "Escape" && setOpen(false));
  look.subscribe(refresh);
  setOpen(false);
}
